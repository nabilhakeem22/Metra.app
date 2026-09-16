import 'server-only';
// Sections and their lines, margin-gated. Split out of ./detail.ts so the
// assembly there reads as its three phases rather than as a wall of mapping.
//
// THE MARGIN GATE LIVES HERE, twice: `toDetailLine` omits the three per-line cost
// fields, and the section's own cost/margin are only COMPUTED when the caller may
// see them — so a viewer's payload never carries the figure, not even to be
// dropped later. Omitting rather than nulling is deliberate: a field that is not
// on the object cannot be rendered by accident or serialized into an API
// response.
import { proposalLines, proposalSections, type MetraDb } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import { computeSection, type LineTotals } from '@/lib/aggregates/proposal-totals';
import type { ProposalDetailLine, ProposalDetailSection } from './detail-types';

type ProposalLineRow = typeof proposalLines.$inferSelect;

/** One stored line as the caller sees it — cost and margin ONLY when allowed. */
function toDetailLine(
  line: ProposalLineRow,
  canSeeMargin: boolean,
): ProposalDetailLine {
  const detail: ProposalDetailLine = {
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

/** R5: group lines by section ONCE, rather than an O(sections x lines) filter. */
function groupLinesBySection(
  lines: ProposalLineRow[],
): Map<string, ProposalLineRow[]> {
  const bySection = new Map<string, ProposalLineRow[]>();
  for (const line of lines) {
    const existing = bySection.get(line.sectionId);
    if (existing) existing.push(line);
    else bySection.set(line.sectionId, [line]);
  }
  return bySection;
}

/** The section's own cost and margin, computed from its lines — margin-gated. */
function computeSectionMargin(lines: ProposalLineRow[]): {
  sectionCost: string;
  sectionMargin: string;
} {
  const totals = computeSection(
    lines.map(
      (line): LineTotals => ({
        lineCost: line.lineCost,
        lineTotal: line.lineTotal,
        lineMargin: line.lineMargin,
      }),
    ),
  );
  return { sectionCost: totals.sectionCost, sectionMargin: totals.sectionMargin };
}

/**
 * Sections in order, each carrying its own lines in order.
 *
 * Two queries and an in-memory group, never a query per section: a fit-out
 * proposal runs to hundreds of lines and an N+1 here is the difference between
 * two round trips and three hundred.
 */
export async function loadProposalSections(
  tx: MetraDb,
  proposalId: string,
  canSeeMargin: boolean,
): Promise<ProposalDetailSection[]> {
  const sections = await tx
    .select()
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.sortOrder));
  const allLines = await tx
    .select()
    .from(proposalLines)
    .where(eq(proposalLines.proposalId, proposalId))
    .orderBy(asc(proposalLines.sortOrder));
  const linesBySection = groupLinesBySection(allLines);

  return sections.map((section) => {
    const sectionLines = linesBySection.get(section.id) ?? [];
    return {
      id: section.id,
      titleAr: section.titleAr,
      titleEn: section.titleEn,
      sortOrder: section.sortOrder,
      sectionSubtotal: section.sectionSubtotal,
      lines: sectionLines.map((line) => toDetailLine(line, canSeeMargin)),
      ...(canSeeMargin ? computeSectionMargin(sectionLines) : {}),
    };
  });
}
