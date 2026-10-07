// The sentence for a `client_responded` notification: what the client did, on
// which delivery. PURE and CLIENT-SAFE, like feed-item.ts, which calls it.
//
// `{delivery}` is the delivery's number (bidi-isolated, so `DE-2026-0012` reads
// the same inside Arabic) and its title in the reader's language, falling back to
// the other. Numbers reach the catalogue as STRINGS (Latin digits); the one number
// passed as a number, `commentCount`, only selects the plural form.
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDocNumber } from '@/lib/format/doc-number';
import {
  CLIENT_RESPONDED_BODY_KEYS,
  type ClientRespondedBodyKey,
} from '@/lib/notifications/kinds';

export type BodyTranslate = (key: string, values?: Record<string, string | number>) => string;

export function isClientRespondedBodyKey(bodyKey: string): bodyKey is ClientRespondedBodyKey {
  return (CLIENT_RESPONDED_BODY_KEYS as readonly string[]).includes(bodyKey);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const wholeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

/** "DE-2026-0012 · Villa kitchen", the title by locale, either part optional. */
export function deliveryLabel(params: Record<string, unknown>, locale: string): string {
  const number = wholeNumber(params.number);
  const year = wholeNumber(params.year);
  const arabic = text(params.titleAr);
  const english = text(params.titleEn);
  const title = locale.startsWith('ar') ? (arabic ?? english) : (english ?? arabic);
  const reference = number && year ? bidiIsolate(formatDocNumber('DE', number, year)) : null;
  return [reference, title].filter(Boolean).join(' · ');
}

export function clientRespondedBody(
  bodyKey: ClientRespondedBodyKey,
  params: Record<string, unknown>,
  translate: BodyTranslate,
  locale: string,
  milestoneLabel: (kind: string) => string | null,
): string {
  const delivery = deliveryLabel(params, locale);
  if (bodyKey === 'client_payment_claimed' && (wholeNumber(params.count) ?? 1) > 1) {
    // Repeated claims collapse into one unread row whose params name only the
    // latest milestone: say how many, not just the last one.
    const count = wholeNumber(params.count) ?? 1;
    return translate('client_payment_claimed_many', { delivery, claimCount: count, count: String(count) });
  }
  if (bodyKey === 'client_payment_claimed') {
    const milestone = text(params.milestoneKind) ? milestoneLabel(String(params.milestoneKind)) : null;
    return translate(bodyKey, {
      delivery,
      hasMilestone: milestone ? 'yes' : 'no',
      milestone: milestone ?? '',
    });
  }
  if (bodyKey === 'client_commented') {
    const count = wholeNumber(params.count) ?? 1;
    return translate(bodyKey, { delivery, commentCount: count, count: String(count) });
  }
  return translate(bodyKey, { delivery });
}
