// Shared proposal-core guards, normalizers, and constants + createProposalCore.
// The heavy draft save lives in ./draft-save and the lifecycle transitions in
// ./lifecycle; both are re-exported here so `@/lib/proposals/core` stays the one
// import surface for callers/tests. The server recomputes EVERY total from the
// money engine and never trusts a client-supplied subtotal/total.
import { createHash, randomBytes } from 'node:crypto';
import {
  clients,
  projects,
  proposals,
  type CostItemUnit,
  type MetraDb,
} from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import {
  formatProposalNumber,
  proposalYear,
} from '@/lib/format/proposal-number';

import { normalizeText, validIsoDate } from './validation';

// The pure validators + boundary caps live in ./validation (client-safe, unit-
// testable). Re-exported so `@/lib/proposals/core` stays the one import surface.
export {
  SHARE_TTL_DAYS,
  MAX_SECTIONS,
  MAX_LINES_PER_SECTION,
  MAX_TOTAL_LINES,
  MAX_AMOUNT,
  LINE_INSERT_CHUNK,
  normalizeText,
  normalizeMoney,
  withinMagnitude,
  pctInRange,
  validIsoDate,
  chunk,
} from './validation';

export function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/** Per-org advisory lock so concurrent creates never collide on `number`. */
export async function nextNumber(tx: MetraDb, orgId: string): Promise<number> {
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
  const [client] = await tx
    .select({ active: clients.active })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client || !client.active) fail('client_required');
  const [project] = await tx
    .select({ active: projects.active })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || !project.active) fail('invalid');
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
  if (!clientId || !isUuid(clientId)) return err('client_required');
  if (!projectId || !isUuid(projectId)) return err('invalid');
  const issueDate = normalizeText(input.issueDate);
  const expiryDate = normalizeText(input.expiryDate);
  if (issueDate && !validIsoDate(issueDate)) return err('invalid_date');
  if (expiryDate && !validIsoDate(expiryDate)) return err('invalid_date');

  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'create' },
    async (tx, audit) => {
      await assertClientProjectUsable(tx, clientId, projectId);
      const number = await nextNumber(tx, ctx.orgId);

      let titleEn = normalizeText(input.titleEn);
      const titleAr = normalizeText(input.titleAr);
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

// The heavy draft save + the lifecycle transitions live in their own modules but
// stay importable from here (the historical import surface for callers/tests).
export { saveProposalDraftCore } from './draft-save';
export {
  deleteDraftProposalCore,
  expireProposalCore,
  sendProposalCore,
  supersedeProposalCore,
} from './lifecycle';
