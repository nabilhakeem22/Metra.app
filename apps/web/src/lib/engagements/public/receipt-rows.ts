// The payments the studio received, read off an UNTRUSTED delivery snapshot
// (Round D, 0059: `receipts`, apart from the 60-entry timeline). PURE and
// client-safe. A malformed entry (an unknown kind, a bad amount or instant) is
// DROPPED; nothing here throws.
import { isoInstant, positiveAmount } from './snapshot-values';
import type { PortalPaymentKind, PortalReceipt } from './timeline-types';

/** The SQL returns at most 200; a longer array is cut, never trusted. */
export const RECEIPTS_MAX_ENTRIES = 200;

const PAYMENT_KINDS: ReadonlySet<string> = new Set<PortalPaymentKind>([
  'deposit',
  'gate_a',
  'gate_b',
  'balance',
  'revision_co',
]);

/** A payment kind the portal has words for. */
export function isPortalPaymentKind(kind: unknown): kind is PortalPaymentKind {
  return typeof kind === 'string' && PAYMENT_KINDS.has(kind);
}

function receiptOf(raw: unknown): PortalReceipt | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const amount = positiveAmount(row.amount);
  const at = isoInstant(row.at);
  if (!isPortalPaymentKind(row.kind) || amount === null || at === null) return null;
  return { kind: row.kind, amount, at };
}

/** The receipts, newest first as the SQL ordered them, every malformed entry dropped. */
export function parseReceipts(raw: unknown): PortalReceipt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, RECEIPTS_MAX_ENTRIES)
    .map(receiptOf)
    .filter((receipt): receipt is PortalReceipt => receipt !== null);
}
