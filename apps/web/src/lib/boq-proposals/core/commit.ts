// The ONE write of Send as BOQ: turn the mapped proposal into an issued `boqs`
// document, in one transaction, after its PDF already exists. PURE core.
import { proposals, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { AuditEntry } from '@/lib/audit';
import { recomputeBoqTotals } from '@/lib/boqs/core';
import { freezeAndRecordIssue } from '@/lib/boqs/issue';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { formatDocNumber } from '@/lib/format/doc-number';
import type { MappedBoq } from '../map';
import { findSentRevision, type SentBoq } from '../sent-revision';
import { proposalRevision, type SendSnapshot } from '../snapshot';
import { insertBoqHeader, insertSectionsAndLines } from './commit-persist';

export interface CommitProposalBoqInput {
  proposalId: string;
  expectedRevision: string;
  expectedNumber: number;
  expectedYear: number;
  engagement: SendSnapshot['engagement'];
  header: Omit<SendSnapshot['proposal'], 'id' | 'revision'>;
  mapped: MappedBoq;
  file: { fileId: string; label: string };
}

/** Lock the working copy and read its revision; null when gone or not a BOQ. */
async function lockProposalRevision(tx: MetraDb, proposalId: string): Promise<string | null> {
  const [row] = await tx
    .select({ revision: proposalRevision })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.kind, 'boq')))
    .for('update');
  return row?.revision ?? null;
}

/**
 * The fences. The PDF was rendered from a snapshot taken WITHOUT a lock, so the
 * commit proves nothing moved since: the proposal's revision (read under the
 * lock, compared as SQL text), the year the PDF printed, and the number it
 * printed (re-allocated under the per-org advisory lock). Any difference is
 * `boq_send_conflict` and nothing is written.
 */
async function fenceSnapshot(
  tx: MetraDb,
  orgId: string,
  input: CommitProposalBoqInput,
  lockedRevision: string,
): Promise<number> {
  if (lockedRevision !== input.expectedRevision) fail('boq_send_conflict');
  if (new Date().getUTCFullYear() !== input.expectedYear) fail('boq_send_conflict');
  const number = await allocateNumber(tx, orgId, 'boq', 'boqs', 'number');
  if (number !== input.expectedNumber) fail('boq_send_conflict');
  return number;
}

/**
 * Insert the BOQ, its sections and lines, re-sum it in the database, then issue
 * it through the same write half the sheet's Issue button uses: supersede the
 * previous version, freeze, record and publish the artifact.
 */
async function issueNewVersion(
  tx: MetraDb,
  ctx: OrgContext,
  audit: (entry: AuditEntry) => Promise<void>,
  input: CommitProposalBoqInput,
  number: number,
): Promise<SentBoq> {
  const boqId = await insertBoqHeader(tx, ctx.orgId, number, {
    proposalId: input.proposalId,
    revision: input.expectedRevision,
    engagement: input.engagement,
    header: input.header,
  });
  await insertSectionsAndLines(tx, ctx.orgId, boqId, input.mapped);
  await recomputeBoqTotals(tx, boqId, input.header.discountPct);
  const { version } = await freezeAndRecordIssue(tx, ctx, {
    boqId,
    projectId: input.engagement.projectId,
    engagementId: input.engagement.id,
    ...input.file,
  });
  await audit({
    entity: 'proposal',
    entityId: input.proposalId,
    action: 'issue',
    after: { boq_id: boqId, version },
  });
  return { boqId, documentNumber: formatDocNumber('BQ', number, input.expectedYear) };
}

/**
 * IDEMPOTENT PER REVISION. Under the proposal's row lock (which serialises two
 * sends of one working copy), a revision that was already sent answers with the
 * BOQ it produced and writes NOTHING: no number, no artifact, no audit row. Only
 * then do the fences run and the next version get issued. The proposal itself
 * is never touched and stays `draft`, so "Edit and send a new version" is just
 * the builder again.
 */
export async function commitProposalBoqCore(
  ctx: OrgContext,
  input: CommitProposalBoqInput,
): Promise<ActionResult & { data?: SentBoq }> {
  return mutateInOrg(ctx, { capability: 'boq_build', action: 'create' }, async (tx, audit) => {
    const lockedRevision = await lockProposalRevision(tx, input.proposalId);
    if (lockedRevision === null) fail('boq_send_conflict');
    const replay = await findSentRevision(tx, input.proposalId, input.expectedRevision);
    if (replay) return replay;
    const number = await fenceSnapshot(tx, ctx.orgId, input, lockedRevision);
    return issueNewVersion(tx, ctx, audit, input, number);
  });
}
