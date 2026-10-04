// Open the delivery's BOQ working copy: return the engagement's BOQ proposal,
// creating it the first time. PURE core — no next/*, no cookies.
import { designEngagements, proposals, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { AuditEntry } from '@/lib/audit';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { isTerminal } from '@/lib/engagements/states';
import { can } from '@/lib/permissions/can';
import { isUuid } from '@/lib/uuid';

type EngagementRef = { id: string; clientId: string; projectId: string };

/** The engagement in this org, refusing a terminal one. */
async function requireActiveEngagement(
  tx: MetraDb,
  engagementId: string,
): Promise<EngagementRef> {
  const engagement = await requireInOrg(
    tx,
    designEngagements,
    engagementId,
    {
      id: designEngagements.id,
      clientId: designEngagements.clientId,
      projectId: designEngagements.projectId,
      state: designEngagements.state,
    },
    'engagement_not_found',
  );
  if (isTerminal(engagement.state)) fail('engagement_not_active');
  return engagement;
}

async function existingBoqProposalId(
  tx: MetraDb,
  engagementId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.engagementId, engagementId))
    .limit(1);
  return row?.id ?? null;
}

/** A BOQ proposal is unpriced by VAT and supervision from its first row. */
async function insertBoqProposal(
  tx: MetraDb,
  orgId: string,
  number: number,
  engagement: EngagementRef,
): Promise<string> {
  const [row] = await tx
    .insert(proposals)
    .values({
      orgId,
      number,
      kind: 'boq',
      engagementId: engagement.id,
      clientId: engagement.clientId,
      projectId: engagement.projectId,
      taxRate: '0',
      supervisionPct: '0',
      titleEn: 'Bill of Quantities',
      titleAr: 'مقايسة الأعمال',
    })
    .returning({ id: proposals.id });
  if (!row) fail('generic');
  return row.id;
}

function auditOpened(
  audit: (entry: AuditEntry) => Promise<void>,
  proposalId: string,
  engagementId: string,
): Promise<void> {
  return audit({
    entity: 'proposal',
    entityId: proposalId,
    action: 'create',
    before: null,
    after: { kind: 'boq', engagement_id: engagementId },
  });
}

/**
 * Idempotent: a second call returns the same id. The number is allocated FIRST
 * because its per-org advisory lock is what serializes two concurrent opens of
 * one engagement (the second waits, then finds the first's row); it is max+1, so
 * nothing is consumed when the proposal already exists. The unique constraint is
 * the backstop if anything ever bypasses that lock.
 */
export async function openBoqProposalCore(
  ctx: OrgContext,
  input: { engagementId: string },
): Promise<ActionResult & { data?: string }> {
  if (!can(ctx.role, 'boq_build', 'create')) return err('forbidden');
  if (!isUuid(input.engagementId)) return err('invalid');

  return mutateInOrg(
    ctx,
    {
      capability: 'proposals_build',
      action: 'create',
      conflict: { constraint: 'proposals_org_engagement_unique', code: 'boq_send_conflict' },
    },
    async (tx, audit) => {
      const engagement = await requireActiveEngagement(tx, input.engagementId);
      const number = await allocateNumber(tx, ctx.orgId, 'proposals', 'proposals', 'number');
      const existing = await existingBoqProposalId(tx, engagement.id);
      if (existing) return existing;
      const proposalId = await insertBoqProposal(tx, ctx.orgId, number, engagement);
      await auditOpened(audit, proposalId, engagement.id);
      return proposalId;
    },
  );
}
