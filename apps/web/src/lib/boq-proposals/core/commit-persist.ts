// Send as BOQ, the rows: WRITE DOWN what the snapshot and the mapper decided.
// Nothing here fences, validates or computes anything; `commit.ts` is the
// transaction's shape (fences, replay, issue), this is its inserts. Split along
// the same seam as `boqs/core/import-persist.ts`.
import { boqLines, boqSections, boqs, type MetraDb } from '@metra/db';
import { fail } from '@/lib/actions/mutate';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';
import type { MappedBoq } from '../map';
import type { SendSnapshot } from '../snapshot';

export interface BoqHeaderInsert {
  proposalId: string;
  /** The revision being sent, stored so a replay of it is recognised. */
  revision: string;
  engagement: SendSnapshot['engagement'];
  header: Omit<SendSnapshot['proposal'], 'id' | 'revision'>;
}

/** The `boqs` row: a built BOQ, cut from this revision of the working copy. */
export async function insertBoqHeader(
  tx: MetraDb,
  orgId: string,
  number: number,
  input: BoqHeaderInsert,
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
      sourceRevision: input.revision,
    })
    .returning({ id: boqs.id });
  if (!row) fail('generic');
  return row.id;
}

/** Sections one at a time (their ids key the lines), then the lines in chunks. */
export async function insertSectionsAndLines(
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
