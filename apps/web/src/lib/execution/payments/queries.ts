import 'server-only';
// The payment ledger of one execution contract, newest first, 50 rows a page
// (plan A25). Keyset on (received_on desc, id desc), the order of
// `contract_payments_org_contract_received_idx`, so page 40 costs what page 1
// costs. Inside the caller's org transaction: RLS scopes it to the org.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { formatDocNumber } from '@/lib/format/doc-number';
import { isUuid } from '@/lib/uuid';
import { validIsoDate } from '@/lib/validation/iso-date';

const PAYMENTS_PAGE_SIZE = 50;

interface ContractPaymentRow {
  id: string;
  /** The request it paid, by its PR number. */
  requestNumber: string;
  amount: string;
  receivedOn: string;
  method: string | null;
  reference: string | null;
  note: string | null;
}

export interface ContractPaymentsPage {
  rows: ContractPaymentRow[];
  /** Where the next page starts; null on the last page. */
  nextCursor: string | null;
}

/** The last row of a page as the next page's start: `<received_on>_<id>`. */
const cursorOf = (row: ContractPaymentRow) => `${row.receivedOn}_${row.id}`;

/** A cursor this module wrote, or null for anything else (the action is directly invokable). */
export function readPaymentsCursor(raw: unknown): { receivedOn: string; id: string } | null {
  if (typeof raw !== 'string') return null;
  const [receivedOn, id, extra] = raw.split('_');
  if (extra !== undefined || !receivedOn || !validIsoDate(receivedOn) || !isUuid(id)) return null;
  return { receivedOn, id };
}

type PaymentSqlRow = {
  id: string; amount: string; received_on: string; method: string | null; reference: string | null;
  note: string | null; request_number: number; request_year: number;
};

export async function listContractPayments(
  tx: MetraDb,
  contractId: string,
  after: { receivedOn: string; id: string } | null,
): Promise<ContractPaymentsPage> {
  const rows = (await tx.execute(sql`
    select p.id, p.amount::text, to_char(p.received_on, 'YYYY-MM-DD') as received_on, p.method, p.reference, p.note,
           r.number as request_number, extract(year from r.issued_on)::int as request_year
      from public.contract_payments p
      join public.payment_requests r on r.id = p.request_id
     where p.contract_id = ${contractId}
       ${after ? sql`and (p.received_on, p.id) < (${after.receivedOn}::date, ${after.id}::uuid)` : sql``}
     order by p.received_on desc, p.id desc
     limit ${PAYMENTS_PAGE_SIZE + 1}
  `)) as unknown as PaymentSqlRow[];
  const page = rows.slice(0, PAYMENTS_PAGE_SIZE).map((row) => ({
    id: row.id,
    requestNumber: formatDocNumber('PR', row.request_number, row.request_year),
    amount: row.amount,
    receivedOn: row.received_on,
    method: row.method,
    reference: row.reference,
    note: row.note,
  }));
  return { rows: page, nextCursor: rows.length > PAYMENTS_PAGE_SIZE ? cursorOf(page[page.length - 1]) : null };
}
