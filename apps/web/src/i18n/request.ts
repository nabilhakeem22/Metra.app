import { getRequestConfig } from 'next-intl/server';
import { LOCALES, routing, type Locale } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = LOCALES.includes(requested as Locale)
    ? (requested as Locale)
    : routing.defaultLocale;

  return {
    locale,
    // Egypt-based studios; a global default timeZone prevents next-intl's
    // ENVIRONMENT_FALLBACK error and server/client hydration mismatches when any
    // surface formats a date/time.
    timeZone: 'Africa/Cairo',
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
