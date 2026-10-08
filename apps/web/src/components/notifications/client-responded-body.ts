// The sentence for a `client_responded` notification: what the client did, on
// which delivery. PURE and CLIENT-SAFE, like feed-item.ts, which calls it.
//
// `{delivery}` is the delivery's label (./delivery-label.ts). Numbers reach the
// catalogue as STRINGS (Latin digits); the one number
// passed as a number, `commentCount`, only selects the plural form. A chosen
// concept option reads as its letter (`optionPosition`, written by the notifier
// from the saved choice, 0057), bidi-isolated like the number.
import { conceptLetter } from '@/lib/engagements/concept-letter';
import { bidiIsolate } from '@/lib/format/bidi';
import {
  CLIENT_RESPONDED_BODY_KEYS,
  type ClientRespondedBodyKey,
} from '@/lib/notifications/kinds';
import { deliveryLabelOf } from './delivery-label';

export type BodyTranslate = (key: string, values?: Record<string, string | number>) => string;

export function isClientRespondedBodyKey(bodyKey: string): bodyKey is ClientRespondedBodyKey {
  return (CLIENT_RESPONDED_BODY_KEYS as readonly string[]).includes(bodyKey);
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const wholeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

export function clientRespondedBody(
  bodyKey: ClientRespondedBodyKey,
  params: Record<string, unknown>,
  translate: BodyTranslate,
  locale: string,
  milestoneLabel: (kind: string) => string | null,
): string {
  const delivery = deliveryLabelOf(params, locale);
  // One unread row per MILESTONE since 0057, so a count above 1 is the same
  // milestone claimed again: the sentence always names that milestone.
  if (bodyKey === 'client_payment_claimed') {
    const milestone = text(params.milestoneKind) ? milestoneLabel(String(params.milestoneKind)) : null;
    return translate(bodyKey, {
      delivery,
      hasMilestone: milestone ? 'yes' : 'no',
      milestone: milestone ?? '',
    });
  }
  if (bodyKey === 'client_concept_chosen') {
    const letter = conceptLetter(params.optionPosition);
    return translate(bodyKey, {
      delivery,
      hasLetter: letter ? 'yes' : 'no',
      letter: letter ? bidiIsolate(letter) : '',
    });
  }
  if (bodyKey === 'client_commented') {
    const count = wholeNumber(params.count) ?? 1;
    return translate(bodyKey, { delivery, commentCount: count, count: String(count) });
  }
  return translate(bodyKey, { delivery });
}
