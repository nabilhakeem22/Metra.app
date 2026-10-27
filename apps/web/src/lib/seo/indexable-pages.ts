import { LOCALES, routing, type Locale } from '@/i18n/routing';

// The ONE list of what search engines may index: the landing page, once per
// locale. PURE and CLIENT-SAFE. The sitemap, the landing's hreflang alternates
// and the middleware's noindex exemption all read it, so they cannot disagree.

/** ISO date of the last meaningful landing-copy change. Bump it in the PR that changes landing copy. */
export const LANDING_LAST_MODIFIED = '2026-10-27';

/** The hreflang `x-default` target: the default locale's landing. */
export const X_DEFAULT_LOCALE: Locale = routing.defaultLocale;

/** The landing page of one locale. */
export function landingPath(locale: Locale): string {
  return `/${locale}`;
}

const INDEXABLE_PATHS: ReadonlySet<string> = new Set(LOCALES.map(landingPath));

/** Exact match only: `/ar-EG` is indexable, `/ar-EG/` and `/ar-EG/login` are not. */
export function isIndexablePath(pathname: string): boolean {
  return INDEXABLE_PATHS.has(pathname);
}

/** Relative hreflang map for metadata: every locale's landing plus `x-default`. */
export function landingLanguageAlternates(): Record<Locale | 'x-default', string> {
  const byLocale = Object.fromEntries(LOCALES.map((locale) => [locale, landingPath(locale)]));
  return { ...byLocale, 'x-default': landingPath(X_DEFAULT_LOCALE) } as Record<Locale | 'x-default', string>;
}
