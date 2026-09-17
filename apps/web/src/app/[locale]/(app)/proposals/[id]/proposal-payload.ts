import type { LineState, SectionState } from './builder-model';

// WHAT A CLIENT SIGNS, built from what is on screen. PURE and server-safe: no
// React, no db. It was an untested closure inside a 243-line component, which is
// an odd place for the function that shapes the document a studio sends out.

export interface ProposalPayloadHeader {
  discountPct: string;
  taxRate: string;
  supervisionPct: string;
}

export interface ProposalPayloadLine {
  /** The stable id, round-tripped so the server preserves this line's STORED
   *  cost. Ids are not secret, so it is sent even when margin is hidden. */
  id: string | null;
  costItemId: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  qty: string;
  unit: LineState['unit'];
  /** Only sent when the role may SEE cost; otherwise null, and the core keeps
   *  the stored cost by line id (null -> preserved / defaulted). Sending '0'
   *  here from a margin-blind role would zero a real cost. */
  unitCost: string | null;
  unitPrice: string;
  discountPct: string;
  sortOrder: number;
}

export interface ProposalPayloadSection {
  titleEn: string | null;
  titleAr: string | null;
  sortOrder: number;
  lines: ProposalPayloadLine[];
}

export interface ProposalPayload {
  id: string;
  header: ProposalPayloadHeader;
  sections: ProposalPayloadSection[];
}

export interface ProposalDraftState {
  id: string;
  discountPct: string;
  taxRate: string;
  supervisionPct: string;
  sections: SectionState[];
  /** Whether this role may see — and therefore send — cost. */
  seeMargin: boolean;
}

/** An empty text box means "absent", not "the empty string". */
function textOrNull(value: string): string | null {
  return value || null;
}

/** An empty number box means zero, which is what the server would have stored. */
function numberOrZero(value: string): string {
  return value || '0';
}

function payloadLine(
  line: LineState,
  sortOrder: number,
  seeMargin: boolean,
): ProposalPayloadLine {
  return {
    id: line.id,
    costItemId: line.costItemId,
    descriptionEn: textOrNull(line.descriptionEn),
    descriptionAr: textOrNull(line.descriptionAr),
    qty: numberOrZero(line.qty),
    unit: line.unit,
    unitCost: seeMargin ? numberOrZero(line.unitCost) : null,
    unitPrice: numberOrZero(line.unitPrice),
    discountPct: numberOrZero(line.discountPct),
    sortOrder,
  };
}

/**
 * The draft as the server expects it. Section and line order come from ARRAY
 * POSITION, which is what the builder's move-up/move-down buttons change — so the
 * order a studio sees is the order that is stored.
 */
export function buildProposalPayload(state: ProposalDraftState): ProposalPayload {
  return {
    id: state.id,
    header: {
      discountPct: numberOrZero(state.discountPct),
      taxRate: numberOrZero(state.taxRate),
      supervisionPct: numberOrZero(state.supervisionPct),
    },
    sections: state.sections.map((section, sectionIndex) => ({
      titleEn: textOrNull(section.titleEn),
      titleAr: textOrNull(section.titleAr),
      sortOrder: sectionIndex,
      lines: section.lines.map((line, lineIndex) =>
        payloadLine(line, lineIndex, state.seeMargin),
      ),
    })),
  };
}
