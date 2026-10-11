import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';

export const LOCALES = ['ar-EG', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: 'ar-EG',
});

/** The visitor's negotiated locale: next-intl's default cookie, which `routing` does not rename. */
export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE';

export function isRtl(locale: string): boolean {
  return locale.startsWith('ar');
}

export function dirFor(locale: string): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
