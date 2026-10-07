import 'server-only';
// How a studio email names the delivery the client acted on: `DE-YYYY-NNNN ·
// title`, read through the same token the client just used (the client has no
// session, so the studio's own queries are out of reach).
//
// It reads the portal snapshot: the only token read that carries the number
// and titles today. The caller bounds it to the notifier's remaining budget
// and skips the label when it is late. The narrow alternative (the notifier
// returning number/year/titles itself) waits for the next database step.
import { getDeliveryByToken } from '@/lib/engagements/public';
import { cairoYear, formatDocNumber } from '@/lib/format/doc-number';
import { TITLE_MAX_CHARS, oneLine } from '@/lib/format/one-line';
import { pickLocale } from '@/lib/i18n/pick-locale';

/**
 * The label, or '' when the delivery cannot be read right now (the email then
 * reads without it). The YEAR is the creation year in Cairo, the one rule every
 * DE number follows (lib/format/doc-number.ts). The title is one capped line.
 */
export async function deliveryLabelForEmail(rawToken: string, locale: string): Promise<string> {
  const read = await getDeliveryByToken(rawToken);
  if (read.status !== 'ok') return '';
  const { number, createdAt, titleAr, titleEn } = read.delivery;
  const title = oneLine(pickLocale({ titleAr, titleEn }, 'title', locale).value, TITLE_MAX_CHARS);
  const year = createdAt ? cairoYear(createdAt) : Number.NaN;
  const docNumber = Number.isFinite(year) ? formatDocNumber('DE', number, year) : '';
  return [docNumber, title].filter(Boolean).join(' · ');
}
