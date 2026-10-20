// The contract share page's shapes, exactly as `app_contract_by_token` and
// `app_contract_section_lines_by_token` return them (snake_case, money as
// strings). PURE TYPES: the client components name them without pulling the
// server-only reader into their bundle. Cost-blind by construction: the SQL
// never returns a cost or a margin column, so none is typed here.
import type { MilestoneBasis } from '@metra/db';

export interface PublicContractLine {
  id: string;
  item_code: string | null;
  description_ar: string | null;
  description_en: string | null;
  qty: string;
  unit: string;
  unit_price: string;
  discount_pct: string;
  line_total: string;
  /** A quantity that is an estimate (بند تقديري): billed as measured at handover. */
  provisional: boolean;
  sort_order: number;
}

export interface PublicContractSection {
  id: string;
  title_ar: string | null;
  title_en: string | null;
  section_subtotal: string;
  sort_order: number;
  /** Every line of the section, counted in SQL. */
  line_count: number;
  /** The section's opening lines; the rest load 100 at a time. */
  lines: PublicContractLine[];
}

/** One row of the payment schedule the client signs; its amount is derived. */
export interface PublicScheduleRow {
  label_ar: string | null;
  label_en: string | null;
  basis: MilestoneBasis;
  value: string;
  sort_order: number;
}

export interface PublicContract {
  id: string;
  number: number;
  status: string;
  title_ar: string | null;
  title_en: string | null;
  currency: string;
  signature_date: string | null;
  start_date: string | null;
  end_date: string | null;
  retention_pct: string;
  retention_release_terms_ar: string | null;
  retention_release_terms_en: string | null;
  advance_pct: string;
  advance_recovery_method: string;
  payment_terms_days: number | null;
  payment_schedule_mode: string;
  penalty_ar: string | null;
  penalty_en: string | null;
  defects_liability_days: number | null;
  scope_inclusions_ar: string | null;
  scope_inclusions_en: string | null;
  scope_exclusions_ar: string | null;
  scope_exclusions_en: string | null;
  terms_ar: string | null;
  terms_en: string | null;
  discount_pct: string;
  tax_rate: string;
  supervision_pct: string;
  subtotal: string;
  discount_amount: string;
  taxable_base: string;
  tax_amount: string;
  supervision_amount: string;
  original_value: string;
  total: string;
  share_expires_at: string | null;
  /** How a signed contract was signed: the Cairo day (YYYY-MM-DD) and the way; null until signed. */
  signed: { on: string; via: 'online' | 'paper' } | null;
  /** 'boq' for an execution contract, generated from a BOQ. */
  source: 'proposal' | 'boq';
  payment_schedule: PublicScheduleRow[];
  /** sha256 over EVERY line and the schedule: what the acknowledgement covers. */
  lines_digest: string;
  time_extension_days_total: number;
  org: { name_ar: string | null; name_en: string | null; logo_file_id: string | null };
  sections: PublicContractSection[];
}

/** One "show more" answer: up to 100 lines of a section, from `offset`. */
export interface PublicSectionLinesPage {
  section_id: string;
  offset: number;
  line_count: number;
  lines: PublicContractLine[];
}

/**
 * The contract as the /c page opens it (A3 reliability R1): its first 50
 * sections, holding the first 50 lines of the whole contract between them, and
 * how many sections it has. The rest come 50 sections at a time.
 */
export interface PublicContractOpening extends PublicContract {
  section_count: number;
}

/** One "show more sections" answer: up to 50 sections from `offset`, collapsed (no lines). */
export interface PublicSectionsPage {
  offset: number;
  section_count: number;
  sections: PublicContractSection[];
}
