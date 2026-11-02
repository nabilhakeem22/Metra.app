import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALES } from '@/i18n/routing';
import { SIGNED_IN_SEGMENTS, TOKEN_SEGMENTS } from '@/lib/seo/private-paths';
import { SRC_ROOT } from '@/test/source-graph';
import robots from './robots';

const SITE = 'https://metra.example';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', SITE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const LOCALE_ROOT = join(SRC_ROOT, 'app', '[locale]');

/** Not URL segments of their own: route groups and the catch-all 404. */
const NOT_A_SEGMENT = new Set(['(app)', '(auth)', '[...rest]']);

function directoriesIn(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** The folders directly under app/[locale] and app/[locale]/(app), split by whether they hold a [token] route. */
function routeSegmentsOnDisk(): { tokens: string[]; signedIn: string[] } {
  const localeChildren = directoriesIn(LOCALE_ROOT).filter((name) => !NOT_A_SEGMENT.has(name));
  const tokens = localeChildren.filter((name) => directoriesIn(join(LOCALE_ROOT, name)).includes('[token]'));
  const signedIn = [
    ...localeChildren.filter((name) => !tokens.includes(name)),
    ...directoriesIn(join(LOCALE_ROOT, '(app)')),
  ];
  return { tokens: tokens.sort(), signedIn: signedIn.sort() };
}

interface RobotsGroup { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] }

function groups(): RobotsGroup[] {
  const rules = robots().rules;
  return Array.isArray(rules) ? rules : [rules];
}

function disallowsOf(group: RobotsGroup): string[] {
  return ([] as string[]).concat(group.disallow ?? []);
}

function perLocale(segments: readonly string[], suffix: string): string[] {
  return LOCALES.flatMap((locale) => segments.map((segment) => `/${locale}/${segment}${suffix}`));
}

describe('robots.txt', () => {
  it('lists every route folder as signed-in or token, and nothing else', () => {
    const onDisk = routeSegmentsOnDisk();
    expect([...SIGNED_IN_SEGMENTS]).toEqual(onDisk.signedIn);
    expect([...TOKEN_SEGMENTS]).toEqual(onDisk.tokens);
  });

  it('has exactly two groups: every crawler, then Googlebot and Bingbot', () => {
    expect(groups().map((group) => group.userAgent)).toEqual(['*', ['Googlebot', 'Bingbot']]);
    for (const group of groups()) expect(group.allow).toBe('/');
  });

  it('keeps every crawler out of the API, the signed-in sections and the token links', () => {
    const [everyCrawler] = groups();
    expect(disallowsOf(everyCrawler!).sort()).toEqual(
      ['/api/', ...perLocale(SIGNED_IN_SEGMENTS, ''), ...perLocale(TOKEN_SEGMENTS, '/')].sort(),
    );
  });

  it('lets the search bots fetch token links, so they see the noindex', () => {
    const [, searchBots] = groups();
    expect(disallowsOf(searchBots!).sort()).toEqual(['/api/', ...perLocale(SIGNED_IN_SEGMENTS, '')].sort());
  });

  it('uses no wildcard', () => {
    for (const group of groups()) for (const path of disallowsOf(group)) expect(path).not.toContain('*');
  });

  it.each([['/ar-EG'], ['/en'], ['/ar-EG/login'], ['/en/login'], ['/_next/static/x.js'], ['/llms.txt'], ['/robots.txt']])(
    'never blocks %s',
    (url) => {
      for (const group of groups()) for (const path of disallowsOf(group)) expect(url.startsWith(path), path).toBe(false);
    },
  );

  it('points at the absolute sitemap and names no host', () => {
    const result = robots();
    expect(result.sitemap).toBe(`${SITE}/sitemap.xml`);
    expect(result.host).toBeUndefined();
  });
});
