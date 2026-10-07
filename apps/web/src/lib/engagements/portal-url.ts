import 'server-only';
// The client's portal URL for a raw delivery token, and the locale a link the
// studio is about to copy opens in. One place, so the share, reveal and
// reminder actions cannot build the link three different ways.
import { getLocale } from 'next-intl/server';
import { LOCALES, routing, type Locale } from '@/i18n/routing';

/** `origin/locale/d/token`. The raw token goes in the path and nowhere else. */
export function deliveryPortalUrl(origin: string, locale: Locale, rawToken: string): string {
  return `${origin}/${locale}/d/${rawToken}`;
}

/** The studio user's current UI locale, or the default outside a localized request. */
export async function requestLocaleOrDefault(): Promise<Locale> {
  try {
    const locale = await getLocale();
    return LOCALES.find((candidate) => candidate === locale) ?? routing.defaultLocale;
  } catch {
    return routing.defaultLocale;
  }
}

/** A locale the portal serves, or null. */
export function portalLocale(value: string): Locale | null {
  return LOCALES.find((candidate) => candidate === value) ?? null;
}
