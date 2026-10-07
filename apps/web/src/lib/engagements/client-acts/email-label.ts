// How a studio email names the delivery the client acted on: `DE-YYYY-NNNN ·
// title`. PURE: the notifier already returned the delivery's number, Cairo
// year and titles (0057), so the label needs no second read through the token.
import { formatDocNumber } from '@/lib/format/doc-number';
import { TITLE_MAX_CHARS, oneLine } from '@/lib/format/one-line';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { StudioNotified } from './studio-notified';

/**
 * The DE number and the one-line title in `locale` (falling back to the other
 * language), joined by ` · `, either part optional. '' when the notifier
 * returned no usable delivery: the email then reads without a label.
 */
export function emailDeliveryLabel(delivery: StudioNotified['delivery'], locale: string): string {
  if (delivery === null) return '';
  const docNumber = formatDocNumber('DE', delivery.number, delivery.year);
  const title = oneLine(
    pickLocale({ titleAr: delivery.titleAr, titleEn: delivery.titleEn }, 'title', locale).value,
    TITLE_MAX_CHARS,
  );
  return [docNumber, title].filter(Boolean).join(' · ');
}
