// The contract detail shapes the page, the PDF template and the public API
// serializer all read.
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

export interface ContractDetail {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ContractStatus;
  currency: string;
  sourceProposalId: string;
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
  sections: ContractDetailSection[];
  // margin-gated
  totalCost?: string;
  totalMargin?: string;
}
