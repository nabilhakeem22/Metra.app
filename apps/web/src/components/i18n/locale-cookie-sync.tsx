'use client';

import { useEffect } from 'react';
import { LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALE_COOKIE_NAME, type Locale } from '@/i18n/routing';

/** The visitor's current NEXT_LOCALE value, or null when there is none. */
function currentLocaleCookie(): string | null {
  for (const pair of document.cookie.split(';')) {
    const [name, ...value] = pair.trim().split('=');
    if (name === LOCALE_COOKIE_NAME) return value.join('=');
  }
  return null;
}

/**
 * Remember the locale of a page served as a static asset (the landing and the
 * login page). The middleware never runs for those, so this writes the
 * NEXT_LOCALE cookie it would have written, with the same attributes, and only
 * when it differs: the next unprefixed visit ("/", "/login") lands in this
 * language.
 */
export function LocaleCookieSync({ locale }: { locale: Locale }) {
  useEffect(() => {
    if (currentLocaleCookie() === locale) return;
    document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
  }, [locale]);
  return null;
}
