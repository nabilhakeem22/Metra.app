// The shapes the BOQ reads return. Type-only and CLIENT-SAFE: the sheet and the
// PDF template import these, and none of them may pull the server-only queries
// in with the type.

export interface BoqLineRow {
  id: string;
  itemCode: string | null;
  description: string;
  unit: string;
  qty: string;
  unitPrice: string;
  /** Per-line discount. Not margin data — it is a reduction off a price the
   *  client already sees, and the sheet needs it to preview a line total that
   *  matches what the server will store. */
  discountPct: string;
  lineTotal: string;
  provisional: boolean;
  /** Margin-gated: present only when the caller may see cost. */
  unitCost?: string;
  lineCost?: string;
  lineMargin?: string;
}

export interface BoqSectionRow {
  id: string;
  title: string;
  sectionSubtotal: string;
  lines: BoqLineRow[];
}

export interface BoqDetail {
  id: string;
  number: number;
  /** `BQ-YYYY-NNNN`, formatted on the SERVER from the UTC year of
   *  `created_at` (the year the issued PDF prints): the BOQ's identity on
   *  screen and in file names. Never re-formatted in the browser. */
  documentNumber: string;
  /** Supersede ordering only (1, 2, 3 on the project). Never displayed: the
   *  BOQ's identity on screen is its document number, BQ-YYYY-NNNN. */
  version: number;
  title: string;
  status: string;
  source: string;
  currency: string;
  discountPct: string;
  subtotal: string;
  discountAmount: string;
  total: string;
  lineCount: number;
  sections: BoqSectionRow[];
  totalCost?: string;
  totalMargin?: string;
}
