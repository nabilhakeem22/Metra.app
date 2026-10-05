// Proposal working copy -> BOQ rows. PURE and CLIENT-SAFE (no db, no
// server-only): the send path renders the PDF and writes the rows from ONE
// mapped object, so the document the client receives and the record in the
// database cannot disagree.
//
// The money is computed by the same engine every other document uses
// (`computeLine` / `computeSection`), and the document roll-up is the BOQ's
// short chain: `total = subtotal - discountAmount`, with NO tax and NO
// supervision. Those are added when the BOQ becomes an execution contract.
import type { CostItemUnit } from '@metra/db';
import {
  computeBoqTotals,
  computeLine,
  computeSection,
  type BoqDocTotals,
  type SectionTotals,
} from '@/lib/boqs/totals';

export interface ProposalSourceLine {
  costItemId: string | null;
  itemCode: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  qty: string;
  unit: CostItemUnit;
  /** '0' when cost was not loaded. */
  unitCost: string;
  unitPrice: string;
  discountPct: string;
}

export interface ProposalSourceSection {
  titleAr: string | null;
  titleEn: string | null;
  lines: ProposalSourceLine[];
}

export interface MappedBoqLine extends ProposalSourceLine {
  lineCost: string;
  lineTotal: string;
  lineMargin: string;
  sortOrder: number;
  provisional: false;
}

export interface MappedBoqSection {
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  sectionSubtotal: string;
  lines: MappedBoqLine[];
}

export interface MappedBoq {
  sections: MappedBoqSection[];
  totals: BoqDocTotals;
  lineCount: number;
  sectionCount: number;
}

function mapLine(line: ProposalSourceLine, sortOrder: number): MappedBoqLine {
  return {
    ...line,
    ...computeLine({
      qty: line.qty,
      unitCost: line.unitCost,
      unitPrice: line.unitPrice,
      discountPct: line.discountPct,
    }),
    sortOrder,
    provisional: false,
  };
}

/**
 * Map the proposal's sections to BOQ sections. Sections with no lines are
 * dropped (an empty section is nothing the client can price against), and
 * `sortOrder` is the position among the KEPT sections and lines.
 */
export function mapProposalToBoq(
  source: ProposalSourceSection[],
  discountPct: string,
): MappedBoq {
  const sectionTotals: SectionTotals[] = [];
  const sections = source
    .filter((section) => section.lines.length > 0)
    .map((section, sectionIndex): MappedBoqSection => {
      const lines = section.lines.map(mapLine);
      const totals = computeSection(lines);
      sectionTotals.push(totals);
      return {
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: sectionIndex,
        sectionSubtotal: totals.sectionSubtotal,
        lines,
      };
    });

  return {
    sections,
    totals: computeBoqTotals(sectionTotals, { discountPct }),
    lineCount: sections.reduce((sum, section) => sum + section.lines.length, 0),
    sectionCount: sections.length,
  };
}
