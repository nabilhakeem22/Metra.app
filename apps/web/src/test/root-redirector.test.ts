import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_COOKIE_NAME, routing } from '@/i18n/routing';
import { WEB_ROOT } from './wrangler-rate-limits';

// public/index.html is the bare "/" as a static asset (CPU relief): it picks
// the locale in the browser, cookie first, then the browser's languages, then
// the default. Its inline script runs here against a fake document, navigator
// and location, and its constants are held equal to src/i18n/routing.ts.

const html = readFileSync(resolve(WEB_ROOT, 'public/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);

interface Visit { cookie?: string; languages?: string[]; search?: string; hash?: string }

function run({ cookie = '', languages = [], search = '', hash = '' }: Visit) {
  const replaced: string[] = [];
  const context: Record<string, unknown> = {
    document: { cookie },
    navigator: { languages, language: languages[0] },
    location: { search, hash, replace: (url: string) => replaced.push(url) },
  };
  runInNewContext(scripts[0]!, context);
  return { replaced, context };
}

describe('the "/" locale redirector (public/index.html)', () => {
  it('has exactly one inline script and a no-script fallback to the default locale', () => {
    expect(scripts).toHaveLength(1);
    expect(html).toContain(`<noscript><meta http-equiv="refresh" content="0; url=/${routing.defaultLocale}"></noscript>`);
  });

  it('keeps its locales, default and cookie name equal to the app routing', () => {
    const { context } = run({});
    expect(context.LOCALES).toEqual([...LOCALES]);
    expect(context.DEFAULT_LOCALE).toBe(routing.defaultLocale);
    expect(context.LOCALE_COOKIE_NAME).toBe(LOCALE_COOKIE_NAME);
  });

  it('declares the default locale document with a title', () => {
    expect(html).toContain(`<html lang="${routing.defaultLocale}" dir="rtl">`);
    expect(html).toContain('<title>ميترا · Metra</title>');
  });

  // A JS redirector cannot carry a canonical or hreflang consistent with where
  // it sends a crawler (an English Googlebot lands on /en), and relative
  // hreflang links are invalid anyway. The landing pages carry them instead.
  it('declares no canonical and no hreflang alternates', () => {
    expect(html).not.toMatch(/rel="canonical"/);
    expect(html).not.toMatch(/hreflang=/);
  });

  it.each<[string, Visit, string]>([
    ['the cookie wins over the browser', { cookie: 'a=1; NEXT_LOCALE=en', languages: ['ar'] }, '/en'],
    ['an unknown cookie falls back to the browser', { cookie: 'NEXT_LOCALE=xx', languages: ['en-GB'] }, '/en'],
    ['an Arabic browser gets ar-EG', { languages: ['AR-sa', 'en'] }, '/ar-EG'],
    ['the first supported browser language wins', { languages: ['fr', 'EN-us', 'ar'] }, '/en'],
    ['an unsupported browser gets the default', { languages: ['fr'] }, '/ar-EG'],
    ['nothing at all gets the default', {}, '/ar-EG'],
    ['a look-alike cookie name is not the locale cookie', { cookie: 'XNEXT_LOCALE=en' }, '/ar-EG'],
    ['the query and fragment are kept', { cookie: 'NEXT_LOCALE=en', search: '?a=1', hash: '#b' }, '/en?a=1#b'],
  ])('%s', (_name, visit, expected) => {
    expect(run(visit).replaced).toEqual([expected]);
  });
});
