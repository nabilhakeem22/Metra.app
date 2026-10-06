// PURE and client-safe. The BOQ as the studio sees it while some of its lines
// are deleted but still inside their Undo window: those lines are GONE from the
// user's point of view, so the section subtotals, the document totals and the
// line count are recomputed without them. Same money engine as the server
// (computeSection / computeBoqTotals over the stored line totals), so the
// figures match what the server will store once the deletes land.
import { computeBoqTotals, computeSection } from './totals';
import type { BoqDetail, BoqLineRow } from './queries/types';

const ZERO = '0.0000';

function lineTotals(line: BoqLineRow) {
  return {
    lineTotal: line.lineTotal,
    lineCost: line.lineCost ?? ZERO,
    lineMargin: line.lineMargin ?? ZERO,
  };
}

export function withoutLines(boq: BoqDetail, hiddenLineIds: ReadonlySet<string>): BoqDetail {
  if (hiddenLineIds.size === 0) return boq;
  let removed = 0;
  const sections = boq.sections.map((section) => {
    const lines = section.lines.filter((line) => !hiddenLineIds.has(line.id));
    if (lines.length === section.lines.length) return section;
    removed += section.lines.length - lines.length;
    return {
      ...section,
      lines,
      sectionSubtotal: computeSection(lines.map(lineTotals)).sectionSubtotal,
    };
  });
  if (removed === 0) return boq;
  const totals = computeBoqTotals(
    sections.map((section) => computeSection(section.lines.map(lineTotals))),
    { discountPct: boq.discountPct },
  );
  return {
    ...boq,
    sections,
    lineCount: boq.lineCount - removed,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    total: totals.total,
    ...(boq.totalCost === undefined
      ? {}
      : { totalCost: totals.totalCost, totalMargin: totals.totalMargin }),
  };
}
