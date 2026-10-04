// The ONE write of Send as BOQ: turn the mapped proposal into an issued `boqs`
// document, in one transaction, after its PDF already exists. PURE core.
import { boqLines, boqSections, boqs, proposals, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { recomputeBoqTotals } from '@/lib/boqs/core';
import { freezeAndRecordIssue } from '@/lib/boqs/issue';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { formatDocNumber } from '@/lib/format/doc-number';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';
import type { MappedBoq } from '../map';
import { proposalRevision, type SendSnapshot } from '../snapshot';

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

/**
 * The fences. The PDF was rendered from a snapshot taken WITHOUT a lock, so the
 * commit proves nothing moved since: the proposal (locked FOR UPDATE, revision
 * compared as SQL text), the year the PDF printed, and the number it printed
 * (re-allocated under the per-org advisory lock). Any difference is
 * `boq_send_conflict` and nothing is written.
 */
async function fenceSnapshot(
  tx: MetraDb,
  orgId: string,
  input: CommitProposalBoqInput,
): Promise<number> {
  const [row] = await tx
    .select({ revision: proposalRevision })
    .from(proposals)
    .where(and(eq(proposals.id, input.proposalId), eq(proposals.kind, 'boq')))
    .for('update');
  if (!row || row.revision !== input.expectedRevision) fail('boq_send_conflict');
  if (new Date().getUTCFullYear() !== input.expectedYear) fail('boq_send_conflict');
  const number = await allocateNumber(tx, orgId, 'boq', 'boqs', 'number');
  if (number !== input.expectedNumber) fail('boq_send_conflict');
  return number;
}

async function insertBoqHeader(
  tx: MetraDb,
  orgId: string,
  number: number,
  input: CommitProposalBoqInput,
): Promise<string> {
  const [row] = await tx
    .insert(boqs)
    .values({
      orgId,
      number,
      titleAr: input.header.titleAr,
      titleEn: input.header.titleEn,
      notesAr: input.header.notesAr,
      notesEn: input.header.notesEn,
      discountPct: input.header.discountPct,
      currency: input.header.currency,
      clientId: input.engagement.clientId,
      projectId: input.engagement.projectId,
      engagementId: input.engagement.id,
      source: 'built',
      sourceProposalId: input.proposalId,
    })
    .returning({ id: boqs.id });
  if (!row) fail('generic');
  return row.id;
}

/** Sections one at a time (their ids key the lines), then the lines in chunks. */
async function insertSectionsAndLines(
  tx: MetraDb,
  orgId: string,
  boqId: string,
  mapped: MappedBoq,
): Promise<void> {
  const lineRows: Array<typeof boqLines.$inferInsert> = [];
  for (const section of mapped.sections) {
    const [inserted] = await tx
      .insert(boqSections)
      .values({
        orgId,
        boqId,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: section.sortOrder,
        sectionSubtotal: section.sectionSubtotal,
      })
      .returning({ id: boqSections.id });
    if (!inserted) fail('generic');
    for (const line of section.lines) {
      lineRows.push({ ...line, orgId, boqId, sectionId: inserted.id });
    }
  }
  await insertLinesInChunks(tx, boqLines, lineRows);
}

/**
 * Insert the BOQ, its sections and lines, re-sum it in the database, then issue
 * it through the same write half the sheet's Issue button uses: supersede the
 * previous version, freeze, record and publish the artifact. The proposal itself
 * is not touched and stays `draft`, so "Edit and send a new version" is just the
 * builder again.
 */
export async function commitProposalBoqCore(
  ctx: OrgContext,
  input: CommitProposalBoqInput,
): Promise<ActionResult & { data?: { boqId: string; documentNumber: string } }> {
  return mutateInOrg(ctx, { capability: 'boq_build', action: 'create' }, async (tx, audit) => {
    const number = await fenceSnapshot(tx, ctx.orgId, input);
    const boqId = await insertBoqHeader(tx, ctx.orgId, number, input);
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
  });
}
