import { createNavigation } from 'next-intl/navigation';
import { defineRouting } from 'next-intl/routing';

export const LOCALES = ['ar-EG', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: 'ar-EG',
});

export function isRtl(locale: string): boolean {
  return locale.startsWith('ar');
}

export function dirFor(locale: string): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
