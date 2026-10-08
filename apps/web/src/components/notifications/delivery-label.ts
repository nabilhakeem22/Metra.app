// How a notification names a delivery: "DE-2026-0012 · Villa kitchen". PURE and
// CLIENT-SAFE. The number is bidi-isolated, so `DE-2026-0012` reads the same
// inside Arabic; the title is the reader's language, falling back to the other.
// Either part may be missing (a row written before the notifier carried them).
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDocNumber } from '@/lib/format/doc-number';

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const wholeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

/** The `{ number, year, titleAr, titleEn }` params of a delivery notification, as one label. */
export function deliveryLabelOf(params: Record<string, unknown>, locale: string): string {
  const number = wholeNumber(params.number);
  const year = wholeNumber(params.year);
  const arabic = text(params.titleAr);
  const english = text(params.titleEn);
  const title = locale.startsWith('ar') ? (arabic ?? english) : (english ?? arabic);
  const reference = number && year ? bidiIsolate(formatDocNumber('DE', number, year)) : null;
  return [reference, title].filter(Boolean).join(' · ');
}
