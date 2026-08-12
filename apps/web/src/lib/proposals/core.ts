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
import { organizations } from '@metra/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import {
  computeLine,
  computeSection,
  computeTotals,
  MONEY_RE,
  type LineTotals,
  type SectionTotals,
} from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';
import {
  formatProposalNumber,
  proposalYear,
} from '@/lib/format/proposal-number';
import { canSeeMargin } from '@/lib/permissions/can';

const SHARE_TTL_DAYS = 30;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// R2 boundary caps (named so the tests + UI can agree on them).
export const MAX_SECTIONS = 100;
export const MAX_LINES_PER_SECTION = 500;
export const MAX_TOTAL_LINES = 2000;
// F4 money magnitude cap — numeric(18,4) tops out near 1e14; stay well under.
export const MAX_AMOUNT = 1_000_000_000_000; // 1e12
const LINE_INSERT_CHUNK = 500;

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

function withinMagnitude(s: string): boolean {
  return Math.abs(Number(s)) <= MAX_AMOUNT;
}

function pctInRange(s: string): boolean {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function validIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
  if (issueDate && !validIsoDate(issueDate)) return err('invalid_date');
  if (expiryDate && !validIsoDate(expiryDate)) return err('invalid_date');

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
  /** Stable identity of an EXISTING line (round-tripped by the builder) so its
   * stored cost is preserved on save. Absent/unknown -> treated as a new line. */
  id?: string | null;
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
    supervisionPct?: string | null;
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

      // Cost-visibility is org+role scoped: only margin-visible callers may
      // change a cost. (Loaded inside the txn under RLS.)
      const [orgRow] = await tx
        .select({ hide: organizations.hideMarginFromPm })
        .from(organizations)
        .limit(1);
      const seeMargin = canSeeMargin(ctx.role, orgRow?.hide ?? true);

      const h = input.header ?? {};
      const discountPct = money(h.discountPct, prop.discountPct);
      const taxRate = money(h.taxRate, prop.taxRate);
      const supervisionPct = money(h.supervisionPct, prop.supervisionPct);
      if (discountPct === null || taxRate === null || supervisionPct === null) {
        fail('invalid');
      }
      if (!pctInRange(discountPct!)) fail('discount_out_of_range');
      if (!pctInRange(supervisionPct!)) fail('supervision_out_of_range');
      const titleEn = h.titleEn !== undefined ? clean(h.titleEn) : prop.titleEn;
      const titleAr = h.titleAr !== undefined ? clean(h.titleAr) : prop.titleAr;
      if (!titleEn && !titleAr) fail('name_required');

      const issueDate =
        h.issueDate !== undefined ? clean(h.issueDate) : prop.issueDate;
      const expiryDate =
        h.expiryDate !== undefined ? clean(h.expiryDate) : prop.expiryDate;
      if (issueDate && !validIsoDate(issueDate)) fail('invalid_date');
      if (expiryDate && !validIsoDate(expiryDate)) fail('invalid_date');

      // R2 caps.
      if (input.sections.length > MAX_SECTIONS) fail('too_many_lines');
      let totalLines = 0;
      for (const s of input.sections) {
        if (s.lines.length > MAX_LINES_PER_SECTION) fail('too_many_lines');
        totalLines += s.lines.length;
      }
      if (totalLines > MAX_TOTAL_LINES) fail('too_many_lines');

      // F1: snapshot this proposal's current line costs by stable id.
      const existingLines = await tx
        .select({ id: proposalLines.id, unitCost: proposalLines.unitCost })
        .from(proposalLines)
        .where(eq(proposalLines.proposalId, input.id));
      const costSnapshot = new Map(existingLines.map((l) => [l.id, l.unitCost]));

      // R2: one lookup for every referenced cost item (validate exist + active).
      const costItemIds = [
        ...new Set(
          input.sections.flatMap((s) =>
            s.lines
              .map((l) => l.costItemId?.trim())
              .filter((x): x is string => !!x),
          ),
        ),
      ];
      const costItemMap = new Map<
        string,
        { unit: CostItemUnit; defaultUnitCost: string; defaultUnitPrice: string; nameEn: string | null; nameAr: string | null }
      >();
      if (costItemIds.length) {
        const cis = await tx
          .select()
          .from(costItems)
          .where(inArray(costItems.id, costItemIds));
        for (const ci of cis) {
          if (!ci.active) fail('invalid');
          costItemMap.set(ci.id, ci);
        }
        for (const cid of costItemIds) {
          if (!costItemMap.has(cid)) fail('invalid');
        }
      }

      // Rebuild sections + lines from scratch (cascade wipes old lines).
      await tx
        .delete(proposalSections)
        .where(eq(proposalSections.proposalId, input.id));

      // Resolve everything in memory FIRST (no per-line statements), then batch.
      interface ResolvedLine {
        costItemId: string | null;
        descriptionAr: string | null;
        descriptionEn: string | null;
        qty: string;
        unit: CostItemUnit;
        unitCost: string;
        unitPrice: string;
        discountPct: string;
        lineCost: string;
        lineTotal: string;
        lineMargin: string;
        sortOrder: number;
      }
      const resolvedSections: Array<{
        titleAr: string | null;
        titleEn: string | null;
        sortOrder: number;
        subtotal: string;
        lines: ResolvedLine[];
      }> = [];
      const sectionTotals: SectionTotals[] = [];

      for (const [si, sec] of input.sections.entries()) {
        const secTitleEn = clean(sec.titleEn);
        const secTitleAr = clean(sec.titleAr);
        if (!secTitleEn && !secTitleAr) fail('name_required');

        const lineTotals: LineTotals[] = [];
        const lines: ResolvedLine[] = [];
        for (const [li, line] of sec.lines.entries()) {
          const costItemId = line.costItemId?.trim() || null;
          const ci = costItemId ? costItemMap.get(costItemId) : undefined;
          const unit = line.unit ?? ci?.unit ?? null;
          const unitPrice = line.unitPrice ?? ci?.defaultUnitPrice ?? null;
          const descriptionEn = clean(line.descriptionEn) ?? ci?.nameEn ?? null;
          const descriptionAr = clean(line.descriptionAr) ?? ci?.nameAr ?? null;

          // F1 cost resolution by stable identity.
          const lineId = line.id?.trim() || null;
          const isExisting = !!lineId && costSnapshot.has(lineId);
          let rawCost: string | null;
          if (isExisting) {
            rawCost = seeMargin
              ? (line.unitCost ?? costSnapshot.get(lineId!)!)
              : costSnapshot.get(lineId!)!;
          } else {
            rawCost = costItemId
              ? ci!.defaultUnitCost
              : seeMargin
                ? line.unitCost || '0'
                : '0';
          }

          const qty = money(line.qty);
          const uCost = money(rawCost);
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
          if (!withinMagnitude(qty!) || !withinMagnitude(uCost!) || !withinMagnitude(uPrice!)) {
            fail('amount_too_large');
          }
          if (!pctInRange(disc!)) fail('discount_out_of_range');

          const totals = computeLine({
            qty: qty!,
            unitCost: uCost!,
            unitPrice: uPrice!,
            discountPct: disc!,
          });
          lineTotals.push(totals);
          lines.push({
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
        }
        const secTotals = computeSection(lineTotals);
        sectionTotals.push(secTotals);
        resolvedSections.push({
          titleAr: secTitleAr,
          titleEn: secTitleEn,
          sortOrder: sec.sortOrder ?? si,
          subtotal: secTotals.sectionSubtotal,
          lines,
        });
      }

      // Batch insert sections (subtotal already computed), then all lines.
      if (resolvedSections.length) {
        const secRows = await tx
          .insert(proposalSections)
          .values(
            resolvedSections.map((s) => ({
              orgId: ctx.orgId,
              proposalId: input.id,
              titleAr: s.titleAr,
              titleEn: s.titleEn,
              sortOrder: s.sortOrder,
              sectionSubtotal: s.subtotal,
            })),
          )
          .returning({ id: proposalSections.id });

        const lineRows = resolvedSections.flatMap((s, i) =>
          s.lines.map((l) => ({
            orgId: ctx.orgId,
            proposalId: input.id,
            sectionId: secRows[i].id,
            ...l,
          })),
        );
        for (const part of chunk(lineRows, LINE_INSERT_CHUNK)) {
          await tx.insert(proposalLines).values(part);
        }
      }

      const totals = computeTotals(sectionTotals, {
        discountPct,
        taxRate,
        supervisionPct,
      });

      await tx
        .update(proposals)
        .set({
          titleAr,
          titleEn,
          issueDate,
          expiryDate,
          currency: clean(h.currency) ?? prop.currency,
          notesAr: h.notesAr !== undefined ? clean(h.notesAr) : prop.notesAr,
          notesEn: h.notesEn !== undefined ? clean(h.notesEn) : prop.notesEn,
          termsAr: h.termsAr !== undefined ? clean(h.termsAr) : prop.termsAr,
          termsEn: h.termsEn !== undefined ? clean(h.termsEn) : prop.termsEn,
          discountPct,
          taxRate,
          supervisionPct,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxableBase: totals.taxableBase,
          taxAmount: totals.taxAmount,
          supervisionAmount: totals.supervisionAmount,
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
      const { raw, hash } = mintToken();
      const shareExpiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86400_000);

      // R3: the draft->sent transition IS the admission gate. A concurrent 2nd
      // send finds status<>'draft' -> 0 rows -> proposal_not_draft, no event, no
      // link (and never overwrites the live token).
      const gated = await tx
        .update(proposals)
        .set({
          status: 'sent',
          tokenHash: hash,
          shareExpiresAt,
          updatedAt: new Date(),
        })
        .where(and(eq(proposals.id, input.id), eq(proposals.status, 'draft')))
        .returning({ id: proposals.id });
      if (!gated[0]) fail('proposal_not_draft');

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
    async (tx) => {
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
      // R1: the sent->superseded transition IS the admission gate. A concurrent
      // 2nd call finds status<>'sent' -> 0 rows -> invalid, and NO copy is made.
      // The returned row carries the original field values (only status flipped).
      const [old] = await tx
        .update(proposals)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(and(eq(proposals.id, input.id), eq(proposals.status, 'sent')))
        .returning();
      if (!old) fail('invalid');

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
          supervisionPct: old.supervisionPct,
          subtotal: old.subtotal,
          discountAmount: old.discountAmount,
          taxableBase: old.taxableBase,
          taxAmount: old.taxAmount,
          supervisionAmount: old.supervisionAmount,
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

      // Deep-copy sections + lines into the new draft (batched, no N+1).
      const oldSections = await tx
        .select()
        .from(proposalSections)
        .where(eq(proposalSections.proposalId, old.id))
        .orderBy(proposalSections.sortOrder);
      if (oldSections.length) {
        const newSecs = await tx
          .insert(proposalSections)
          .values(
            oldSections.map((s) => ({
              orgId: ctx.orgId,
              proposalId: copy.id,
              titleAr: s.titleAr,
              titleEn: s.titleEn,
              sortOrder: s.sortOrder,
              sectionSubtotal: s.sectionSubtotal,
            })),
          )
          .returning({ id: proposalSections.id });
        const idMap = new Map(oldSections.map((s, i) => [s.id, newSecs[i].id]));

        const oldLines = await tx
          .select()
          .from(proposalLines)
          .where(eq(proposalLines.proposalId, old.id));
        const newLineRows = oldLines.map((l) => ({
          orgId: ctx.orgId,
          proposalId: copy.id,
          sectionId: idMap.get(l.sectionId)!,
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
        }));
        for (const part of chunk(newLineRows, LINE_INSERT_CHUNK)) {
          await tx.insert(proposalLines).values(part);
        }
      }

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
