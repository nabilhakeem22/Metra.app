// What app_delivery_notify_studio_by_token answered, narrowed. PURE. It never
// reaches the portal: the studio's member ids and setting stay on the server.
import { LOCALES, type Locale } from '@/i18n/routing';
import { isUuid } from '@/lib/uuid';

/** The delivery the client acted on, as the notifier returned it (0057). */
export interface NotifiedDelivery {
  number: number;
  /** The delivery's creation year in Africa/Cairo: the year its DE number shows. */
  year: number;
  titleAr: string | null;
  titleEn: string | null;
}

export interface StudioNotified {
  engagementId: string;
  /** The studio's default locale: the language of its emails and links. */
  locale: Locale;
  /** Rows inserted or bumped: > 0 is the only time the portal may say "notified". */
  notifiedCount: number;
  /** Members who got a NEW row: the only ones emailed. */
  newRecipients: string[];
  /** Null unless the number and the year are positive integers. */
  delivery: NotifiedDelivery | null;
}

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The delivery identity in the SDF's answer, or null when it is not usable. */
function notifiedDelivery(row: Record<string, unknown>): NotifiedDelivery | null {
  if (!positiveInteger(row.number) || !positiveInteger(row.year)) return null;
  return {
    number: row.number,
    year: row.year,
    titleAr: textOrNull(row.title_ar),
    titleEn: textOrNull(row.title_en),
  };
}

/** The SDF's jsonb, or null when it is absent or not the documented shape. */
export function parseStudioNotified(data: unknown): StudioNotified | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  if (typeof row.engagement_id !== 'string' || !isUuid(row.engagement_id)) return null;
  if (typeof row.notified_count !== 'number' || !Number.isInteger(row.notified_count)) return null;
  if (!Array.isArray(row.new_recipients)) return null;
  const newRecipients = row.new_recipients.filter(
    (id): id is string => typeof id === 'string' && isUuid(id),
  );
  const locale = LOCALES.find((candidate) => candidate === row.locale) ?? 'ar-EG';
  return {
    engagementId: row.engagement_id,
    locale,
    notifiedCount: row.notified_count,
    newRecipients,
    delivery: notifiedDelivery(row),
  };
}
