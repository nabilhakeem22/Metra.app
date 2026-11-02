// A change order as its token SDF answers it and as the client's pages read it.
// PURE TYPES and CLIENT-SAFE: the server reader is ./public.ts, the mapping
// ./public-shape.ts. The SDF omits every cost and margin column.

export interface PublicVariationLine {
  id: string;
  description_ar: string | null;
  description_en: string | null;
  qty: string;
  unit: string;
  unit_price: string;
  discount_pct: string;
  line_total: string;
  sort_order: number;
}

export interface PublicVariation {
  id: string;
  number: number;
  status: string;
  title_ar: string | null;
  title_en: string | null;
  reason_ar: string | null;
  reason_en: string | null;
  net_delta: string;
  currency: string;
  contract_number: number;
  share_expires_at: string | null;
  /** Is the parent contract still commercially live (issued or signed)? */
  contractActive: boolean;
  /** Which kind of contract the order is on: a 'boq' one is decided in the client home (./home-deciding.ts). */
  contractSource: 'boq' | 'proposal';
  /**
   * WHO rejected this variation order, or null when nothing was recorded (0051).
   * 'client' is the client's own refusal, through the token path or on paper
   * as the studio recorded it (H7.3: the SDF reads `recorded_on_paper` as
   * 'client'); 'staff' is the termination cascade. null is every row written
   * before 0051.
   */
  rejectionChannel: 'client' | 'staff' | null;
  /**
   * The parent execution contract's VAT and supervision rates, which the order
   * is charged on top of its works (D4a). Null on a proposal contract, whose
   * page shows the net change alone, exactly as before Stage 2.
   */
  charges: { taxRate: string; supervisionPct: string } | null;
  /** Days the order adds to the contract's finish date; null = none recorded. */
  timeExtensionDays: number | null;
  /**
   * The contract's finish as its approved change orders moved it (DB step B,
   * B5 D1): its end date and the days ALL its approved orders add. Null on a
   * proposal contract, and from a database before step B.
   */
  finish: { endDate: string | null; approvedExtensionDays: number } | null;
  org: { name_ar: string | null; name_en: string | null; logo_file_id: string | null };
  lines: PublicVariationLine[];
}

/** The SDF's snake_case document, before it is mapped onto PublicVariation. */
export type VariationTokenDocument = Omit<
  PublicVariation,
  'contractActive' | 'contractSource' | 'rejectionChannel' | 'charges' | 'timeExtensionDays' | 'finish'
> & {
  contract_active: boolean | null;
  rejection_channel: unknown;
  tax_rate: unknown;
  supervision_pct: unknown;
  time_extension_days: unknown;
  contract_source: unknown;
  contract_end_date: unknown;
  time_extension_days_total: unknown;
};
