// The execution card's snapshot (app_delivery_execution_by_token) mapped onto
// what the browser receives. PURE and client-safe, so it is tested without a
// socket. The snapshot is UNTRUSTED like the delivery's: a malformed request or
// receipt is DROPPED, a malformed contract drops the card, and nothing here
// throws. No key is copied through by spreading, so a key the SQL might add
// later never reaches the browser unless it is named here.
import { formatDocNumber } from '@/lib/format/doc-number';
import type {
  PortalContractStatus,
  PortalEarlierClaim,
  PortalExecution,
  PortalExecutionReceipt,
  PortalExecutionRequest,
} from './execution-types';
import { EARLIER_CLAIMS_CAP, EXECUTION_LIST_CAP } from './execution-types';
import { boundedText, calendarDay, isoInstant, nonNegativeAmount, positiveAmount } from './snapshot-values';
import { parsePaymentDetails } from './studio-rows';

type Row = Record<string, unknown>;

const CONTRACT_STATUSES: ReadonlySet<string> = new Set<PortalContractStatus>(['issued', 'signed', 'terminated']);

/** A title or label the studio typed; the SQL holds them to their columns' caps. */
const TEXT_MAX = 300;

const asRow = (raw: unknown): Row | null => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Row) : null);

const wholeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

/** PREFIX-YYYY-NNNN from a number and a year, or null when either is not one. */
function documentNumber(prefix: 'C' | 'PR' | 'VO', number: unknown, year: unknown): string | null {
  const seq = wholeNumber(number);
  const at = wholeNumber(year);
  return seq && at ? formatDocNumber(prefix, seq, at) : null;
}

function targetOf(row: Row): PortalExecutionRequest['target'] | null {
  if (row.kind === 'milestone') {
    return { kind: 'milestone', labelAr: boundedText(row.label_ar, TEXT_MAX), labelEn: boundedText(row.label_en, TEXT_MAX) };
  }
  if (row.kind === 'variation') {
    return { kind: 'variation', documentNumber: documentNumber('VO', row.variation_number, row.variation_year) };
  }
  return row.kind === 'final_account' ? { kind: 'final_account' } : null;
}

function requestOf(raw: unknown): PortalExecutionRequest | null {
  const row = asRow(raw);
  if (!row || typeof row.id !== 'string' || (row.status !== 'issued' && row.status !== 'void')) return null;
  const number = documentNumber('PR', row.number, row.year);
  const target = targetOf(row);
  const amount = positiveAmount(row.amount);
  const paid = nonNegativeAmount(row.paid);
  const outstanding = nonNegativeAmount(row.outstanding);
  const issuedOn = calendarDay(row.issued_on);
  if (!number || !target || !amount || !paid || !outstanding || !issuedOn) return null;
  return {
    id: row.id,
    documentNumber: number,
    target,
    amount,
    paid,
    outstanding,
    issuedOn,
    dueOn: calendarDay(row.due_on),
    void: row.status === 'void',
    claimedAt: row.has_pending_claim === true ? isoInstant(row.claimed_at) : null,
  };
}

function receiptOf(raw: unknown): PortalExecutionReceipt | null {
  const row = asRow(raw);
  if (!row) return null;
  const amount = positiveAmount(row.amount);
  const receivedOn = calendarDay(row.received_on);
  const requestNumber = documentNumber('PR', row.request_number, row.request_year);
  return amount && receivedOn && requestNumber ? { amount, receivedOn, requestNumber } : null;
}

function earlierClaimOf(raw: unknown): PortalEarlierClaim | null {
  const row = asRow(raw);
  if (!row) return null;
  const requestNumber = documentNumber('PR', row.request_number, row.request_year);
  const amount = positiveAmount(row.amount);
  const claimedAt = isoInstant(row.claimed_at);
  return requestNumber && amount && claimedAt ? { requestNumber, amount, claimedAt } : null;
}

/** The rows of a list, newest first as the SQL ordered them, cut at its cap, every malformed one dropped. */
function listOf<T>(raw: unknown, read: (row: unknown) => T | null, cap = EXECUTION_LIST_CAP): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, cap).map(read).filter((row): row is T => row !== null);
}

/** The card, or null when the snapshot carries no contract this build can show. */
export function shapeExecution(raw: unknown): PortalExecution | null {
  const snapshot = asRow(raw);
  const contract = asRow(snapshot?.contract);
  if (!snapshot || !contract || typeof contract.status !== 'string' || !CONTRACT_STATUSES.has(contract.status)) return null;
  const number = documentNumber('C', contract.number, contract.year);
  const originalValue = nonNegativeAmount(contract.original_value);
  if (!number || !originalValue) return null;
  return {
    contract: {
      documentNumber: number,
      status: contract.status as PortalContractStatus,
      titleAr: boundedText(contract.title_ar, TEXT_MAX),
      titleEn: boundedText(contract.title_en, TEXT_MAX),
      originalValue,
    },
    requests: listOf(snapshot.requests, requestOf),
    requestsTruncated: snapshot.requests_truncated === true,
    receipts: listOf(snapshot.receipts, receiptOf),
    receiptsTruncated: snapshot.receipts_truncated === true,
    // Absent from a database before the B4 fix round: none.
    earlierClaims: listOf(snapshot.earlier_claims, earlierClaimOf, EARLIER_CLAIMS_CAP),
    // The SQL sends them only while some request is still due (AC35); the
    // usable-method rule is applied again here, as for the design fee.
    paymentDetails: parsePaymentDetails(snapshot.payment_details, true),
  };
}
