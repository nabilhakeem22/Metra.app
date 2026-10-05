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

/**
 * ONE insert for every section, returning their ids IN INPUT ORDER, so each line
 * is pointed at its section by index rather than by a round trip per section
 * (the pattern of `proposals/core/draft-save-persist.ts` insertDraftSections).
 * A row count that differs from the input would misfile lines: refused.
 */
async function insertSections(
  tx: MetraDb,
  orgId: string,
  boqId: string,
  mapped: MappedBoq,
): Promise<string[]> {
  if (mapped.sections.length === 0) return [];
  const rows = await tx
    .insert(boqSections)
    .values(
      mapped.sections.map((section) => ({
        orgId,
        boqId,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: section.sortOrder,
        sectionSubtotal: section.sectionSubtotal,
      })),
    )
    .returning({ id: boqSections.id });
  if (rows.length !== mapped.sections.length) fail('generic');
  return rows.map((row) => row.id);
}

/** The sections in one statement, then the lines in chunks. */
export async function insertSectionsAndLines(
  tx: MetraDb,
  orgId: string,
  boqId: string,
  mapped: MappedBoq,
): Promise<void> {
  const sectionIds = await insertSections(tx, orgId, boqId, mapped);
  const lineRows: Array<typeof boqLines.$inferInsert> = mapped.sections.flatMap(
    (section, index) =>
      section.lines.map((line) => ({ ...line, orgId, boqId, sectionId: sectionIds[index] })),
  );
  await insertLinesInChunks(tx, boqLines, lineRows);
}
