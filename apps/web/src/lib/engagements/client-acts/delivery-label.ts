import 'server-only';
// How a studio email names the delivery the client acted on: `DE-YYYY-NNNN ·
// title`, read through the same token the client just used (the client has no
// session, so the studio's own queries are out of reach).
import { todayInCairo } from '@/lib/automation/clock';
import { getDeliveryByToken } from '@/lib/engagements/public';
import { formatDocNumber } from '@/lib/format/doc-number';
import { pickLocale } from '@/lib/i18n/pick-locale';

/**
 * The label, or '' when the delivery cannot be read right now (the email then
 * reads without it). The YEAR is the delivery's creation year in Cairo, the
 * same clock the notification's own params use (app_delivery_notify_studio_by_token).
 */
export async function deliveryLabelForEmail(rawToken: string, locale: string): Promise<string> {
  const read = await getDeliveryByToken(rawToken);
  if (read.status !== 'ok') return '';
  const { number, createdAt, titleAr, titleEn } = read.delivery;
  const title = pickLocale({ titleAr, titleEn }, 'title', locale).value.trim();
  const year = createdAt ? Number(todayInCairo(new Date(createdAt)).slice(0, 4)) : null;
  const docNumber = year && Number.isFinite(year) ? formatDocNumber('DE', number, year) : '';
  return [docNumber, title].filter(Boolean).join(' · ');
}
