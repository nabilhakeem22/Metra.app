import 'server-only';
// The deep copy at the heart of contract generation: an accepted proposal's
// sections and lines become the contract's baseline, value for value.
//
// NOTHING IS RECOMPUTED. `lineCost`, `lineTotal` and `lineMargin` are carried
// across exactly as the client accepted them, because the contract baseline must
// equal the accepted quote to the piastre — a recomputation that differed by one
// piastre would be a contract the client never signed.
import {
  contractLines,
  contractSections,
  proposalLines,
  proposalSections,
  type MetraDb,
} from '@metra/db';
import { eq } from 'drizzle-orm';
import { insertLinesInChunks } from '@/lib/lines/insert-chunked';

/**
 * Copy the sections, and return old section id -> new section id.
 *
 * ONE insert, never a query per section: its RETURNING order matches the input
 * order, which is what lets the id map be built without a second round trip each.
 */
async function copyProposalSections(
  tx: MetraDb,
  orgId: string,
  proposalId: string,
  contractId: string,
): Promise<Map<string, string>> {
  const oldSections = await tx
    .select()
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(proposalSections.sortOrder);
  if (!oldSections.length) return new Map();

  const newSections = await tx
    .insert(contractSections)
    .values(
      oldSections.map((section) => ({
        orgId,
        contractId,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: section.sortOrder,
        sectionSubtotal: section.sectionSubtotal,
      })),
    )
    .returning({ id: contractSections.id });
  return new Map(
    oldSections.map((section, index) => [section.id, newSections[index].id]),
  );
}

type ProposalLineRow = typeof proposalLines.$inferSelect;

/** One proposal line as a contract line: same money, new owners. */
function toContractLineRow(
  line: ProposalLineRow,
  orgId: string,
  contractId: string,
  sectionId: string,
) {
  return {
    orgId,
    contractId,
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

/** Copy the lines onto their new sections, batched under the bind-parameter cap. */
async function copyProposalLines(
  tx: MetraDb,
  orgId: string,
  proposalId: string,
  contractId: string,
  newSectionId: Map<string, string>,
): Promise<void> {
  const oldLines = await tx
    .select()
    .from(proposalLines)
    .where(eq(proposalLines.proposalId, proposalId));
  await insertLinesInChunks(
    tx,
    contractLines,
    oldLines.map((line) =>
      toContractLineRow(line, orgId, contractId, newSectionId.get(line.sectionId)!),
    ),
  );
}

/**
 * Copy every section and line of `proposalId` onto `contractId`.
 *
 * A proposal with no sections is a no-op: it can have no lines either, since
 * every line hangs off a section.
 */
export async function copyProposalContentToContract(
  tx: MetraDb,
  orgId: string,
  proposalId: string,
  contractId: string,
): Promise<void> {
  const newSectionId = await copyProposalSections(tx, orgId, proposalId, contractId);
  if (!newSectionId.size) return;
  await copyProposalLines(tx, orgId, proposalId, contractId, newSectionId);
}
