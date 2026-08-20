// Stage 3 of the draft save: batch-insert the resolved sections (subtotal
// precomputed) then all lines, chunked to stay under the bind-parameter cap.
import { proposalLines, proposalSections, type MetraDb } from '@metra/db';
import { chunk, LINE_INSERT_CHUNK } from './core';
import type { ResolvedSection } from './draft-save-resolve';

/** Batch-insert the resolved sections (subtotal precomputed) then all lines. */
export async function persistDraftSectionsAndLines(
  tx: MetraDb,
  orgId: string,
  proposalId: string,
  resolvedSections: ResolvedSection[],
): Promise<void> {
  if (!resolvedSections.length) return;
  const sectionRows = await tx
    .insert(proposalSections)
    .values(
      resolvedSections.map((section) => ({
        orgId,
        proposalId,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: section.sortOrder,
        sectionSubtotal: section.subtotal,
      })),
    )
    .returning({ id: proposalSections.id });

  const lineRows = resolvedSections.flatMap((section, index) =>
    section.lines.map((line) => ({
      orgId,
      proposalId,
      sectionId: sectionRows[index].id,
      ...line,
    })),
  );
  for (const part of chunk(lineRows, LINE_INSERT_CHUNK)) {
    await tx.insert(proposalLines).values(part);
  }
}
