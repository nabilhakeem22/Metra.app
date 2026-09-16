import 'server-only';
// Sections and their lines, margin-gated. Split out of ./detail.ts so the
// assembly there reads as its four phases rather than as a wall of mapping.
//
// THE MARGIN GATE LIVES HERE: `toDetailLine` OMITS unitCost / lineCost /
// lineMargin unless the caller may see them. Omitting rather than nulling is
// deliberate — a field that is not on the object cannot be rendered by accident
// or serialized into an API response.
import { contractLines, contractSections, type MetraDb } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import type { ContractDetailLine, ContractDetailSection } from './detail-types';

type ContractLineRow = typeof contractLines.$inferSelect;

/** One stored line as the caller sees it — cost and margin ONLY when allowed. */
function toDetailLine(
  line: ContractLineRow,
  canSeeMargin: boolean,
): ContractDetailLine {
  const detail: ContractDetailLine = {
    id: line.id,
    descriptionAr: line.descriptionAr,
    descriptionEn: line.descriptionEn,
    costItemId: line.costItemId,
    qty: line.qty,
    unit: line.unit,
    unitPrice: line.unitPrice,
    discountPct: line.discountPct,
    lineTotal: line.lineTotal,
    sortOrder: line.sortOrder,
  };
  if (canSeeMargin) {
    detail.unitCost = line.unitCost;
    detail.lineCost = line.lineCost;
    detail.lineMargin = line.lineMargin;
  }
  return detail;
}

/** Lines keyed by their section, input order preserved inside each bucket. */
function groupLinesBySection(lines: ContractLineRow[]): Map<string, ContractLineRow[]> {
  const bySection = new Map<string, ContractLineRow[]>();
  for (const line of lines) {
    const existing = bySection.get(line.sectionId);
    if (existing) existing.push(line);
    else bySection.set(line.sectionId, [line]);
  }
  return bySection;
}

/**
 * Sections in order, each carrying its own lines in order.
 *
 * Two queries and an in-memory group, never a query per section: a fit-out
 * contract runs to hundreds of lines and an N+1 here is the difference between
 * two round trips and three hundred.
 */
export async function loadContractSections(
  tx: MetraDb,
  contractId: string,
  canSeeMargin: boolean,
): Promise<ContractDetailSection[]> {
  const sections = await tx
    .select()
    .from(contractSections)
    .where(eq(contractSections.contractId, contractId))
    .orderBy(asc(contractSections.sortOrder));
  const allLines = await tx
    .select()
    .from(contractLines)
    .where(eq(contractLines.contractId, contractId))
    .orderBy(asc(contractLines.sortOrder));
  const linesBySection = groupLinesBySection(allLines);

  return sections.map((section) => ({
    id: section.id,
    titleAr: section.titleAr,
    titleEn: section.titleEn,
    sortOrder: section.sortOrder,
    sectionSubtotal: section.sectionSubtotal,
    lines: (linesBySection.get(section.id) ?? []).map((line) =>
      toDetailLine(line, canSeeMargin),
    ),
  }));
}
