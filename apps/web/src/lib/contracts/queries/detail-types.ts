// The contract detail shapes: the PDF's (every line) and the page's (sections
// counted in SQL, lines a page at a time).
//
// PURE TYPES ONLY — no `server-only`, no runtime value — so a client component
// can name `ContractDetail` without pulling the query layer into its bundle.
//
// THE MARGIN GATE IS IN THE TYPE: `unitCost`, `lineCost`, `lineMargin`,
// `totalCost` and `totalMargin` are OPTIONAL, and the loader omits them entirely
// unless the caller may see margin. A field that is absent cannot be rendered by
// accident, serialized into an API response, or read off a client payload.
import type { ContractStatus } from '@metra/db';

export interface ContractDetailLine {
  id: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  costItemId: string | null;
  qty: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  lineTotal: string;
  sortOrder: number;
  // margin-gated
  unitCost?: string;
  lineCost?: string;
  lineMargin?: string;
}

export interface ContractDetailSection {
  id: string;
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  sectionSubtotal: string;
  lines: ContractDetailLine[];
}

/** A line as the contract page shows it. It carries no cost, so it has no margin gate to keep. */
export interface ContractLineView {
  id: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  qty: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
}

/** One request's lines (never more than 50) and whether more follow them. */
export interface ContractLinesPage {
  lines: ContractLineView[];
  hasMore: boolean;
}

/** A contract line as the variation picker offers it: what it reads as, and its section. */
export interface ContractLineOption {
  id: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  sectionTitleAr: string | null;
  sectionTitleEn: string | null;
}

/** One picker answer (never more than 50 lines) and whether more matched after them. */
export interface ContractLineOptionsPage {
  lines: ContractLineOption[];
  hasMore: boolean;
}

/**
 * A section as the contract page opens it: its line count from SQL, and only
 * the lines that fall inside the page's opening window (the first 50 lines of
 * the whole contract). The rest load on demand, a page at a time.
 */
export interface ContractSectionSummary {
  id: string;
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  sectionSubtotal: string;
  lineCount: number;
  openingLines: ContractLineView[];
}

/** Everything about a contract but its sections. */
export interface ContractHeaderDetail {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ContractStatus;
  currency: string;
  /** Null on an execution contract generated from a BOQ (0063). */
  sourceProposalId: string | null;
  signatureDate: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  clientId: string;
  projectId: string;
  clientNameEn: string | null;
  clientNameAr: string | null;
  retentionPct: string;
  retentionReleaseTermsAr: string | null;
  retentionReleaseTermsEn: string | null;
  advancePct: string;
  advanceRecoveryMethod: string;
  paymentTermsDays: number | null;
  paymentScheduleMode: string;
  penaltyAr: string | null;
  penaltyEn: string | null;
  defectsLiabilityDays: number | null;
  scopeInclusionsAr: string | null;
  scopeInclusionsEn: string | null;
  scopeExclusionsAr: string | null;
  scopeExclusionsEn: string | null;
  termsAr: string | null;
  termsEn: string | null;
  discountPct: string;
  taxRate: string;
  supervisionPct: string;
  subtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
  supervisionAmount: string;
  originalValue: string;
  // Computed aggregate (A3): originalValue + Σ approved-VO netDeltas.
  revisedValue: string;
  // margin-gated
  totalCost?: string;
  totalMargin?: string;
}

/** The contract with every line: what the PDF prints. */
export interface ContractDetail extends ContractHeaderDetail {
  sections: ContractDetailSection[];
}

/** The contract as its page opens: bounded whatever the contract's size. */
export interface ContractPageDetail extends ContractHeaderDetail {
  sections: ContractSectionSummary[];
}
