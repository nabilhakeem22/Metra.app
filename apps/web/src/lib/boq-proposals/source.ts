import 'server-only';
import { costItems, proposalLines, proposalSections, type MetraDb } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import type { ProposalSourceLine, ProposalSourceSection } from './map';

/**
 * A BOQ proposal's sections and lines as the mapper reads them, in builder
 * order, inside the caller's RLS transaction. The price-book `code` rides along
 * as the BOQ line's item code.
 *
 * `includeCost: false` reads every unit cost as '0' rather than the stored one,
 * so a caller who may not see margin cannot get it through this path.
 */
export async function loadProposalSource(
  tx: MetraDb,
  proposalId: string,
  opts: { includeCost: boolean },
): Promise<ProposalSourceSection[]> {
  const sections = await tx
    .select({
      id: proposalSections.id,
      titleAr: proposalSections.titleAr,
      titleEn: proposalSections.titleEn,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.sortOrder));

  const lines = await tx
    .select({
      sectionId: proposalLines.sectionId,
      costItemId: proposalLines.costItemId,
      itemCode: costItems.code,
      descriptionAr: proposalLines.descriptionAr,
      descriptionEn: proposalLines.descriptionEn,
      qty: proposalLines.qty,
      unit: proposalLines.unit,
      unitCost: proposalLines.unitCost,
      unitPrice: proposalLines.unitPrice,
      discountPct: proposalLines.discountPct,
    })
    .from(proposalLines)
    .leftJoin(costItems, eq(costItems.id, proposalLines.costItemId))
    .where(eq(proposalLines.proposalId, proposalId))
    .orderBy(asc(proposalLines.sortOrder));

  const bySection = new Map<string, ProposalSourceLine[]>();
  for (const { sectionId, unitCost, ...line } of lines) {
    const row: ProposalSourceLine = {
      ...line,
      unitCost: opts.includeCost ? unitCost : '0',
    };
    const existing = bySection.get(sectionId);
    if (existing) existing.push(row);
    else bySection.set(sectionId, [row]);
  }

  return sections.map((section) => ({
    titleAr: section.titleAr,
    titleEn: section.titleEn,
    lines: bySection.get(section.id) ?? [],
  }));
}
