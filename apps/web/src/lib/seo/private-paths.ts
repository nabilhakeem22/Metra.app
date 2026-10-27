import { LOCALES } from '@/i18n/routing';

// The private URL segments robots.txt disallows. PURE. Spelled out per locale,
// never as a `/*/x` wildcard, which also matches `/_next/x...` and other
// unrelated paths. app/robots.test.ts derives the segments from the
// app/[locale] folder tree, so a new route cannot ship unlisted.

/** (app) + onboarding segments: private for every crawler. Keep sorted. */
export const SIGNED_IN_SEGMENTS = [
  'boq',
  'clients',
  'contracts',
  'dashboard',
  'engagements',
  'market-book',
  'notifications',
  'onboarding',
  'price-book',
  'projects',
  'proposals',
  'settings',
  'team',
] as const;

/** Token links: noindex, crawlable by search bots only. Keep sorted. */
export const TOKEN_SEGMENTS = ['c', 'd', 'invite', 'p', 'v'] as const;

function perLocale(segments: readonly string[], suffix: string): string[] {
  return LOCALES.flatMap((locale) => segments.map((segment) => `/${locale}/${segment}${suffix}`));
}

/** Per locale, no trailing slash: `/ar-EG/boq`, `/en/boq`, ... (the section and everything under it). */
export function signedInDisallows(): string[] {
  return perLocale(SIGNED_IN_SEGMENTS, '');
}

/** Per locale, WITH a trailing slash: `/ar-EG/c/`, ... (the links under the segment). */
export function tokenDisallows(): string[] {
  return perLocale(TOKEN_SEGMENTS, '/');
}
