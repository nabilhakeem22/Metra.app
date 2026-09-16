// The proposal detail shapes the builder, the view page, the PDF template and
// the public API serializer all read.
//
// PURE TYPES ONLY — no `server-only`, no runtime value — so a client component
// can name `ProposalDetail` without pulling the query layer into its bundle.
//
// THE MARGIN GATE IS IN THE TYPE: `unitCost`, `lineCost`, `lineMargin`,
// `sectionCost`, `sectionMargin`, `totalCost` and `totalMargin` are OPTIONAL, and
// the loader OMITS them entirely unless the caller may see margin. A field that
// is absent cannot be rendered by accident, serialized into an API response, or
// read off a client payload.
import type { ProposalStatus } from '@metra/db';

export interface ProposalDetailLine {
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

export interface ProposalDetailSection {
  id: string;
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  sectionSubtotal: string;
  lines: ProposalDetailLine[];
  // margin-gated
  sectionCost?: string;
  sectionMargin?: string;
}

export interface ProposalDetail {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ProposalStatus;
  currency: string;
  issueDate: string | null;
  expiryDate: string | null;
  createdAt: string;
  version: number;
  supersedesId: string | null;
  clientId: string;
  projectId: string;
  clientNameEn: string | null;
  clientNameAr: string | null;
  discountPct: string;
  taxRate: string;
  supervisionPct: string;
  subtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
  supervisionAmount: string;
  total: string;
  notesAr: string | null;
  notesEn: string | null;
  termsAr: string | null;
  termsEn: string | null;
  sections: ProposalDetailSection[];
  // margin-gated
  totalCost?: string;
  totalMargin?: string;
}
