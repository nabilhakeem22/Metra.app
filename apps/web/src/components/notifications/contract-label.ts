// How a contract-link notification names its document: `C-2026-0007` for a
// signature, `VO-2026-0003` for a change-order decision (Stage 2, 0063). PURE
// and CLIENT-SAFE, like ./delivery-label.ts. The number is bidi-isolated so it
// reads the same inside Arabic; null when the params do not carry both parts.
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDocNumber } from '@/lib/format/doc-number';
import type { ClientContractBodyKey } from '@/lib/notifications/kinds';

const wholeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

/** The `{ number, year }` params of a contract-link notification, as a document number. */
export function contractDocumentLabelOf(
  bodyKey: ClientContractBodyKey,
  params: Record<string, unknown>,
): string | null {
  const number = wholeNumber(params.number);
  const year = wholeNumber(params.year);
  if (!number || !year) return null;
  const prefix = bodyKey === 'client_contract_signed' ? 'C' : 'VO';
  return bidiIsolate(formatDocNumber(prefix, number, year));
}
