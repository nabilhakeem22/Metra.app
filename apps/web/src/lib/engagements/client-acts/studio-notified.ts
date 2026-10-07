// What app_delivery_notify_studio_by_token answered, narrowed. PURE. It never
// reaches the portal: the studio's member ids and setting stay on the server.
import { LOCALES, type Locale } from '@/i18n/routing';
import { isUuid } from '@/lib/uuid';

export interface StudioNotified {
  engagementId: string;
  /** The studio's default locale: the language of its emails and links. */
  locale: Locale;
  /** Rows inserted or bumped: > 0 is the only time the portal may say "notified". */
  notifiedCount: number;
  /** Members who got a NEW row: the only ones emailed. */
  newRecipients: string[];
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
  };
}
