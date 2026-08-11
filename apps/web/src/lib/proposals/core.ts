// PURE proposal cores. The server recomputes EVERY total from the money engine
// and never trusts a client-supplied subtotal/total. Draft-only edits are
// enforced here (proposal_not_draft) and by the DB child-draft trigger.
import { createHash, randomBytes } from 'node:crypto';
import {
  clients,
  costItems,
  projects,
  proposalEvents,
  proposalLines,
  proposalSections,
  proposals,
  type CostItemUnit,
  type MetraDb,
} from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import {
  computeLine,
  computeSection,
  computeTotals,
  type LineTotals,
  type SectionTotals,
} from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';
import {
  formatProposalNumber,
  proposalYear,
} from '@/lib/format/proposal-number';

const SHARE_TTL_DAYS = 30;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_RE = /^-?\d+(\.\d+)?$/;

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/** Non-negative money string or null. */
function money(v: string | null | undefined, fallback = '0'): string | null {
  const s = v?.trim();
  if (s === undefined || s === '') return fallback;
  if (!MONEY_RE.test(s) || s.startsWith('-')) return null;
  return s;
}

function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/** Per-org advisory lock so concurrent creates never collide on `number`. */
async function nextNumber(tx: MetraDb, orgId: string): Promise<number> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${orgId}:proposals`}))`,
  );
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${proposals.number}), 0)` })
    .from(proposals);
  return Number(row?.max ?? 0) + 1;
}

async function assertClientProjectUsable(
  tx: MetraDb,
  clientId: string,
  projectId: string,
): Promise<void> {
  const [c] = await tx
    .select({ active: clients.active })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!c || !c.active) fail('client_required');
  const [p] = await tx
    .select({ active: projects.active })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!p || !p.active) fail('invalid');
}

export interface CreateProposalInput {
  clientId: string;
  projectId: string;
  titleAr?: string | null;
  titleEn?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
}

export async function createProposalCore(
  ctx: OrgContext,
  input: CreateProposalInput,
): Promise<ActionResult> {
  const clientId = input.clientId?.trim();
  const projectId = input.projectId?.trim();
  if (!clientId || !UUID_RE.test(clientId)) return err('client_required');
  if (!projectId || !UUID_RE.test(projectId)) return err('invalid');
  const issueDate = clean(input.issueDate);
  const expiryDate = clean(input.expiryDate);

  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'create' },
    async (tx, audit) => {
      await assertClientProjectUsable(tx, clientId, projectId);
      const number = await nextNumber(tx, ctx.orgId);

      let titleEn = clean(input.titleEn);
      const titleAr = clean(input.titleAr);
      if (!titleEn && !titleAr) {
        // The DB requires a title; default to the display number.
        titleEn = formatProposalNumber(
          number,
          proposalYear(issueDate, new Date()),
        );
      }

      const [row] = await tx
        .insert(proposals)
        .values({
          orgId: ctx.orgId,
          number,
          titleAr,
          titleEn,
          clientId,
          projectId,
          issueDate,
          expiryDate,
        })
        .returning({ id: proposals.id });

      await audit({
        entity: 'proposal',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { number, client_id: clientId, project_id: projectId },
      });
      return row.id;
    },
  );
}

export interface LineInput {
  costItemId?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  qty?: string | null;
  unit?: CostItemUnit | null;
  unitCost?: string | null;
  unitPrice?: string | null;
  discountPct?: string | null;
  sortOrder?: number;
}

export interface SectionInput {
  id?: string;
  titleAr?: string | null;
  titleEn?: string | null;
  sortOrder?: number;
  lines: LineInput[];
}

export interface SaveDraftInput {
  id: string;
  header?: {
    titleAr?: string | null;
    titleEn?: string | null;
    issueDate?: string | null;
    expiryDate?: string | null;
    discountPct?: string | null;
    taxRate?: string | null;
    currency?: string | null;
    notesAr?: string | null;
    notesEn?: string | null;
    termsAr?: string | null;
    termsEn?: string | null;
  };
  sections: SectionInput[];
}

export async function saveProposalDraftCore(
  ctx: OrgContext,
  input: SaveDraftInput,
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'update' },
    async (tx, audit) => {
      const [prop] = await tx
        .select()
        .from(proposals)
        .where(eq(proposals.id, input.id))
        .limit(1);
      if (!prop) fail('invalid');
      if (prop.status !== 'draft') fail('proposal_not_draft');

      const h = input.header ?? {};
      const discountPct = money(h.discountPct, prop.discountPct);
      const taxRate = money(h.taxRate, prop.taxRate);
      if (discountPct === null || taxRate === null) fail('invalid');
      const titleEn = h.titleEn !== undefined ? clean(h.titleEn) : prop.titleEn;
      const titleAr = h.titleAr !== undefined ? clean(h.titleAr) : prop.titleAr;
      if (!titleEn && !titleAr) fail('name_required');

      // Rebuild sections + lines from scratch (cascade wipes old lines).
      await tx
        .delete(proposalSections)
        .where(eq(proposalSections.proposalId, input.id));

      const sectionTotals: SectionTotals[] = [];
      for (const [si, sec] of input.sections.entries()) {
        const secTitleEn = clean(sec.titleEn);
        const secTitleAr = clean(sec.titleAr);
        if (!secTitleEn && !secTitleAr) fail('name_required');

        const [secRow] = await tx
          .insert(proposalSections)
          .values({
            orgId: ctx.orgId,
            proposalId: input.id,
            titleAr: secTitleAr,
            titleEn: secTitleEn,
            sortOrder: sec.sortOrder ?? si,
          })
          .returning({ id: proposalSections.id });

        const lineTotals: LineTotals[] = [];
        for (const [li, line] of sec.lines.entries()) {
          let unit = line.unit ?? null;
          let unitCost = line.unitCost;
          let unitPrice = line.unitPrice;
          let descriptionEn = clean(line.descriptionEn);
          let descriptionAr = clean(line.descriptionAr);
          const costItemId = line.costItemId?.trim() || null;

          if (costItemId) {
            const [ci] = await tx
              .select()
              .from(costItems)
              .where(eq(costItems.id, costItemId))
              .limit(1);
            if (!ci || !ci.active) fail('invalid');
            unit = unit ?? ci.unit;
            unitCost = unitCost ?? ci.defaultUnitCost;
            unitPrice = unitPrice ?? ci.defaultUnitPrice;
            descriptionEn = descriptionEn ?? ci.nameEn;
            descriptionAr = descriptionAr ?? ci.nameAr;
          }

          const qty = money(line.qty);
          const uCost = money(unitCost);
          const uPrice = money(unitPrice);
          const disc = money(line.discountPct);
          if (
            qty === null ||
            uCost === null ||
            uPrice === null ||
            disc === null ||
            !unit ||
            (!descriptionEn && !descriptionAr)
          ) {
            fail('line_required');
          }

          const totals = computeLine({
            qty: qty!,
            unitCost: uCost!,
            unitPrice: uPrice!,
            discountPct: disc!,
          });

          await tx.insert(proposalLines).values({
            orgId: ctx.orgId,
            proposalId: input.id,
            sectionId: secRow.id,
            costItemId,
            descriptionAr,
            descriptionEn,
            qty: qty!,
            unit: unit!,
            unitCost: uCost!,
            unitPrice: uPrice!,
            discountPct: disc!,
            lineCost: totals.lineCost,
            lineTotal: totals.lineTotal,
            lineMargin: totals.lineMargin,
            sortOrder: line.sortOrder ?? li,
          });
          lineTotals.push(totals);
        }

        const secTotals = computeSection(lineTotals);
        await tx
          .update(proposalSections)
          .set({ sectionSubtotal: secTotals.sectionSubtotal })
          .where(eq(proposalSections.id, secRow.id));
        sectionTotals.push(secTotals);
      }

      const totals = computeTotals(sectionTotals, { discountPct, taxRate });

      await tx
        .update(proposals)
        .set({
          titleAr,
          titleEn,
          issueDate: h.issueDate !== undefined ? clean(h.issueDate) : prop.issueDate,
          expiryDate:
            h.expiryDate !== undefined ? clean(h.expiryDate) : prop.expiryDate,
          currency: clean(h.currency) ?? prop.currency,
          notesAr: h.notesAr !== undefined ? clean(h.notesAr) : prop.notesAr,
          notesEn: h.notesEn !== undefined ? clean(h.notesEn) : prop.notesEn,
          termsAr: h.termsAr !== undefined ? clean(h.termsAr) : prop.termsAr,
          termsEn: h.termsEn !== undefined ? clean(h.termsEn) : prop.termsEn,
          discountPct,
          taxRate,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxableBase: totals.taxableBase,
          taxAmount: totals.taxAmount,
          total: totals.total,
          totalCost: totals.totalCost,
          totalMargin: totals.totalMargin,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, input.id));

      await audit({
        entity: 'proposal',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { sections: input.sections.length, total: totals.total },
      });
    },
  );
}

export async function sendProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_send', action: 'approve' },
    async (tx, audit) => {
      const [prop] = await tx
        .select({ status: proposals.status })
        .from(proposals)
        .where(eq(proposals.id, input.id))
        .limit(1);
      if (!prop) fail('invalid');
      if (prop.status !== 'draft') fail('proposal_not_draft');

      const { raw, hash } = mintToken();
      const shareExpiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86400_000);

      await tx
        .update(proposals)
        .set({
          status: 'sent',
          tokenHash: hash,
          shareExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, input.id));

      await tx.insert(proposalEvents).values({
        orgId: ctx.orgId,
        proposalId: input.id,
        kind: 'sent',
        actorUserId: ctx.userId,
        fromStatus: 'draft',
        toStatus: 'sent',
      });

      await audit({
        entity: 'proposal',
        entityId: input.id,
        action: 'issue',
        before: { status: 'draft' },
        after: { status: 'sent' },
      });
      // The raw token — the action wrapper turns it into the public link.
      return raw;
    },
  );
}

export async function expireProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_send', action: 'approve' },
    async (tx, audit) => {
      const updated = await tx
        .update(proposals)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(and(eq(proposals.id, input.id), eq(proposals.status, 'sent')))
        .returning({ id: proposals.id });
      if (!updated[0]) fail('invalid');

      await tx.insert(proposalEvents).values({
        orgId: ctx.orgId,
        proposalId: input.id,
        kind: 'expired',
        actorUserId: ctx.userId,
        fromStatus: 'sent',
        toStatus: 'expired',
      });
    },
  );
}

export async function supersedeProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'create' },
    async (tx, audit) => {
      const [old] = await tx
        .select()
        .from(proposals)
        .where(eq(proposals.id, input.id))
        .limit(1);
      if (!old) fail('invalid');
      if (old.status !== 'sent') fail('invalid');

      const number = await nextNumber(tx, ctx.orgId);
      const [copy] = await tx
        .insert(proposals)
        .values({
          orgId: ctx.orgId,
          number,
          titleAr: old.titleAr,
          titleEn: old.titleEn,
          clientId: old.clientId,
          projectId: old.projectId,
          status: 'draft',
          currency: old.currency,
          issueDate: old.issueDate,
          expiryDate: old.expiryDate,
          discountPct: old.discountPct,
          taxRate: old.taxRate,
          subtotal: old.subtotal,
          discountAmount: old.discountAmount,
          taxableBase: old.taxableBase,
          taxAmount: old.taxAmount,
          total: old.total,
          totalCost: old.totalCost,
          totalMargin: old.totalMargin,
          notesAr: old.notesAr,
          notesEn: old.notesEn,
          termsAr: old.termsAr,
          termsEn: old.termsEn,
          version: old.version + 1,
          supersedesId: old.id,
        })
        .returning({ id: proposals.id });

      // Deep-copy sections then their lines into the new draft.
      const oldSections = await tx
        .select()
        .from(proposalSections)
        .where(eq(proposalSections.proposalId, old.id));
      for (const s of oldSections) {
        const [ns] = await tx
          .insert(proposalSections)
          .values({
            orgId: ctx.orgId,
            proposalId: copy.id,
            titleAr: s.titleAr,
            titleEn: s.titleEn,
            sortOrder: s.sortOrder,
            sectionSubtotal: s.sectionSubtotal,
          })
          .returning({ id: proposalSections.id });
        const oldLines = await tx
          .select()
          .from(proposalLines)
          .where(eq(proposalLines.sectionId, s.id));
        for (const l of oldLines) {
          await tx.insert(proposalLines).values({
            orgId: ctx.orgId,
            proposalId: copy.id,
            sectionId: ns.id,
            costItemId: l.costItemId,
            descriptionAr: l.descriptionAr,
            descriptionEn: l.descriptionEn,
            qty: l.qty,
            unit: l.unit,
            unitCost: l.unitCost,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            lineCost: l.lineCost,
            lineTotal: l.lineTotal,
            lineMargin: l.lineMargin,
            sortOrder: l.sortOrder,
          });
        }
      }

      await tx
        .update(proposals)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(eq(proposals.id, old.id));

      await tx.insert(proposalEvents).values({
        orgId: ctx.orgId,
        proposalId: old.id,
        kind: 'superseded',
        actorUserId: ctx.userId,
        fromStatus: 'sent',
        toStatus: 'superseded',
      });

      await audit({
        entity: 'proposal',
        entityId: copy.id,
        action: 'create',
        before: { supersedes: old.id },
        after: { number, version: old.version + 1 },
      });
      return copy.id;
    },
  );
}

export async function deleteDraftProposalCore(
  ctx: OrgContext,
  input: { id: string },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'update' },
    async (tx, audit) => {
      const [prop] = await tx
        .select({ status: proposals.status })
        .from(proposals)
        .where(eq(proposals.id, input.id))
        .limit(1);
      if (!prop) fail('invalid');
      if (prop.status !== 'draft') fail('proposal_not_draft');

      await tx.delete(proposals).where(eq(proposals.id, input.id));
      await audit({
        entity: 'proposal',
        entityId: input.id,
        action: 'delete',
        before: { status: 'draft' },
        after: null,
      });
    },
  );
}
