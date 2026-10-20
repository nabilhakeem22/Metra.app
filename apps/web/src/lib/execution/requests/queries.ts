import 'server-only';
// The payment requests of one execution contract, as the Payments tab reads
// them. Bounded (plan A25): the newest 100 requests, and at most 50 change
// orders still to bill, each in ONE statement with what was paid and claimed
// aggregated in SQL, so nothing here grows with the size of the ledger.
// Inside the caller's org transaction: RLS scopes every table to the org.
import type { MetraDb, PaymentRequestKind, PaymentRequestStatus } from '@metra/db';
import { sql } from 'drizzle-orm';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { requestOutstanding } from '../money/outstanding';
import { variationCharge } from '../money/variation-charge';

export const REQUESTS_SHOWN = 100;
/** A change order's number year: its creation year in Cairo, as the register shows it (docYear). */
const CAIRO_YEAR_OF_VARIATION = sql`extract(year from v.created_at at time zone 'Africa/Cairo')::int`;
export const BILLABLE_VARIATIONS_SHOWN = 50;

export interface PaymentRequestRow {
  id: string;
  documentNumber: string;
  kind: PaymentRequestKind;
  status: PaymentRequestStatus;
  /** What it bills: the schedule row's labels, or the change order's number. */
  target: { labelAr: string | null; labelEn: string | null } | { variation: string } | null;
  amount: string;
  taxAmount: string;
  paid: string;
  /** Nothing is due on a void request. */
  outstanding: string;
  issuedOn: string;
  dueOn: string | null;
  note: string | null;
  hasPendingClaim: boolean;
}

type RequestSqlRow = {
  id: string; number: number; kind: PaymentRequestKind; status: PaymentRequestStatus;
  amount: string; tax_amount: string; paid: string; issued_on: string; due_on: string | null; note: string | null;
  label_ar: string | null; label_en: string | null; vo_number: number | null; vo_year: number | null;
  pending_claim: boolean;
};

function targetOf(row: RequestSqlRow): PaymentRequestRow['target'] {
  if (row.kind === 'milestone') return { labelAr: row.label_ar, labelEn: row.label_en };
  if (row.kind === 'variation' && row.vo_number !== null && row.vo_year !== null) {
    return { variation: formatDocNumber('VO', row.vo_number, row.vo_year) };
  }
  return null;
}

/** The newest requests first (by number: the PR sequence is the order they were sent in). */
export async function listPaymentRequests(
  tx: MetraDb,
  contractId: string,
): Promise<{ rows: PaymentRequestRow[]; hasMore: boolean }> {
  const rows = (await tx.execute(sql`
    select r.id, r.number, r.kind, r.status, r.amount::text, r.tax_amount::text,
           to_char(r.issued_on, 'YYYY-MM-DD') as issued_on, to_char(r.due_on, 'YYYY-MM-DD') as due_on, r.note,
           m.label_ar, m.label_en, v.number as vo_number, ${CAIRO_YEAR_OF_VARIATION} as vo_year,
           coalesce((select sum(p.amount) from public.contract_payments p where p.request_id = r.id), 0)::text as paid,
           exists (select 1 from public.contract_payment_claims c
                    where c.request_id = r.id and c.status = 'pending') as pending_claim
      from public.payment_requests r
      left join public.contract_payment_milestones m on m.id = r.milestone_id
      left join public.variation_orders v on v.id = r.variation_order_id
     where r.contract_id = ${contractId}
     order by r.number desc
     limit ${REQUESTS_SHOWN + 1}
  `)) as unknown as RequestSqlRow[];
  return {
    hasMore: rows.length > REQUESTS_SHOWN,
    rows: rows.slice(0, REQUESTS_SHOWN).map((row) => ({
      id: row.id,
      documentNumber: formatDocNumber('PR', row.number, docYear(row.issued_on, row.issued_on)),
      kind: row.kind,
      status: row.status,
      target: targetOf(row),
      amount: row.amount,
      taxAmount: row.tax_amount,
      paid: row.paid,
      outstanding: row.status === 'issued' ? requestOutstanding(row.amount, [row.paid]) : '0.0000',
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      note: row.note,
      hasPendingClaim: row.pending_claim,
    })),
  };
}

export interface BillableVariationRow {
  id: string;
  documentNumber: string;
  titleAr: string | null;
  titleEn: string | null;
  /** What its payment request would bill: works, VAT and supervision (D4a). */
  charge: string;
}

/** Approved change orders that add money and have no live request yet. */
export async function listBillableVariations(
  tx: MetraDb,
  contract: { id: string; taxRate: string; supervisionPct: string },
): Promise<BillableVariationRow[]> {
  const rows = (await tx.execute(sql`
    select v.id, v.number, ${CAIRO_YEAR_OF_VARIATION} as year, v.title_ar, v.title_en, v.net_delta::text as net_delta
      from public.variation_orders v
     where v.contract_id = ${contract.id} and v.status = 'approved' and v.net_delta > 0
       and not exists (select 1 from public.payment_requests r
                        where r.variation_order_id = v.id and r.status = 'issued')
     order by v.number
     limit ${BILLABLE_VARIATIONS_SHOWN}
  `)) as unknown as Array<{ id: string; number: number; year: number; title_ar: string | null; title_en: string | null; net_delta: string }>;
  return rows.map((row) => ({
    id: row.id,
    documentNumber: formatDocNumber('VO', row.number, row.year),
    titleAr: row.title_ar,
    titleEn: row.title_en,
    charge: variationCharge(row.net_delta, contract.taxRate, contract.supervisionPct).total,
  }));
}
