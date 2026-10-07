import 'server-only';
// The reminder text the studio sends its client on WhatsApp, in both portal
// languages, each carrying the portal link in ITS language. The words live in
// the catalog (`delivery.reminder.message`, فصحى in Arabic: it is client-facing).
//
// A translator built straight from the catalogs rather than next-intl's request
// config: the text is for the CLIENT, in a language that need not be the
// studio user's, and the core must also run outside a request (the API, tests).
import { createTranslator } from 'next-intl';
import { LOCALES, type Locale } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n/pick-locale';
import arEG from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { deliveryPortalUrl } from '../portal-url';
import type { ReminderRecipient } from './recipient';

export type ReminderMessages = Record<Locale, string>;

const CATALOGS: Record<Locale, typeof arEG> = { 'ar-EG': arEG, en: en as typeof arEG };

/** One message per portal locale: names by locale, the link in that locale. */
export function reminderMessages(input: {
  origin: string;
  rawToken: string;
  recipient: ReminderRecipient;
}): ReminderMessages {
  const entries = LOCALES.map((locale) => {
    const t = createTranslator({
      locale,
      messages: CATALOGS[locale],
      namespace: 'delivery.reminder',
      // Fail loud to the caller instead of logging and sending the key path to
      // a client; the caller logs a fixed line (the text carries the link).
      onError: (error) => {
        throw error;
      },
    });
    const text = t('message', {
      client: pickLocale(input.recipient.client, 'name', locale).value.trim(),
      studio: pickLocale(input.recipient.studio, 'name', locale).value.trim(),
      link: deliveryPortalUrl(input.origin, locale, input.rawToken),
    });
    return [locale, text] as const;
  });
  return Object.fromEntries(entries) as ReminderMessages;
}
