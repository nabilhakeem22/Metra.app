import 'server-only';
// The deep copy a supersede makes: the sent proposal's sections and lines become
// the new draft's, value for value.
//
// NOTHING IS RECOMPUTED. A superseded proposal is the document the client was
// sent, and the revision starts from exactly what they saw — the studio then
// edits it, and THAT save is where the money engine runs again.
import { proposalLines, proposalSections, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';

export { supersedingProposalRow } from './supersede-row';

type ProposalLineRow = typeof proposalLines.$inferSelect;

/**
 * Copy the sections, and return old section id -> new section id.
 *
 * ONE insert, never a query per section: its RETURNING order matches the input
 * order, which is what lets the id map be built without a round trip each.
 */
async function copySections(
  tx: MetraDb,
  orgId: string,
  fromProposalId: string,
  toProposalId: string,
): Promise<Map<string, string>> {
  const oldSections = await tx
    .select()
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, fromProposalId))
    .orderBy(proposalSections.sortOrder);
  if (!oldSections.length) return new Map();

  const newSections = await tx
    .insert(proposalSections)
    .values(
      oldSections.map((section) => ({
        orgId,
        proposalId: toProposalId,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: section.sortOrder,
        sectionSubtotal: section.sectionSubtotal,
      })),
    )
    .returning({ id: proposalSections.id });
  return new Map(
    oldSections.map((section, index) => [section.id, newSections[index].id]),
  );
}

/** One line re-pointed at the new proposal and its new section. Same money. */
function toCopiedLineRow(
  line: ProposalLineRow,
  orgId: string,
  proposalId: string,
  sectionId: string,
) {
  return {
    orgId,
    proposalId,
    sectionId,
    costItemId: line.costItemId,
    descriptionAr: line.descriptionAr,
    descriptionEn: line.descriptionEn,
    qty: line.qty,
    unit: line.unit,
    unitCost: line.unitCost,
    unitPrice: line.unitPrice,
    discountPct: line.discountPct,
    lineCost: line.lineCost,
    lineTotal: line.lineTotal,
    lineMargin: line.lineMargin,
    sortOrder: line.sortOrder,
  };
}

/**
 * Copy every section and line of `fromProposalId` onto `toProposalId`.
 *
 * A proposal with no sections is a no-op: it can have no lines either, since
 * every line hangs off a section.
 */
export async function copyProposalContent(
  tx: MetraDb,
  orgId: string,
  fromProposalId: string,
  toProposalId: string,
): Promise<void> {
  const newSectionId = await copySections(tx, orgId, fromProposalId, toProposalId);
  if (!newSectionId.size) return;
  const oldLines = await tx
    .select()
    .from(proposalLines)
    .where(eq(proposalLines.proposalId, fromProposalId));
  await insertLinesInChunks(
    tx,
    proposalLines,
    oldLines.map((line) =>
      toCopiedLineRow(line, orgId, toProposalId, newSectionId.get(line.sectionId)!),
    ),
  );
}
