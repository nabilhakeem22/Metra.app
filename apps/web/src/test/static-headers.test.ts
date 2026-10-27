import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/routing';
import { STATIC_ASSET_SECURITY_HEADERS } from '@/lib/http/security-headers';
import { WEB_ROOT } from './wrangler-rate-limits';

// public/_headers: the headers Cloudflare adds to responses served as static
// assets (the Worker, and so the middleware, never runs for them). The login
// assets must say noindex; the indexable pages and the crawl files must carry
// no robots rule. The `/*` block is the security set (lib/http/security-headers.ts)
// and must say exactly what the module says; no other block may set one of its
// names, because Cloudflare comma-joins a header two matching rules both set.

interface HeaderRule { pattern: string; headers: Record<string, string> }

function headerRules(): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const line of readFileSync(resolve(WEB_ROOT, 'public/_headers'), 'utf8').split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: {} });
      continue;
    }
    const separator = line.indexOf(':');
    const current = rules.at(-1);
    if (!current || separator < 0) throw new Error(`public/_headers: a header line outside a rule: ${line}`);
    current.headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return rules;
}

/** Cloudflare's matching: `:name` is one path segment, `*` is anything. */
function matches(pattern: string, path: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]\w*/g, '[^/]+'))
    .join('.*');
  return new RegExp(`^${source}$`).test(path);
}

/** The rules matching `path` that set X-Robots-Tag. */
function robotsRulesFor(path: string): HeaderRule[] {
  return headerRules().filter((rule) => matches(rule.pattern, path) && 'x-robots-tag' in rule.headers);
}

const lowerCased = (headers: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

describe('public/_headers', () => {
  it.each(LOCALES.map((locale) => [`/${locale}/login`]))('%s is noindex, nofollow', (path) => {
    expect(robotsRulesFor(path).map((rule) => rule.headers['x-robots-tag'])).toEqual(['noindex, nofollow']);
  });

  it.each([['/'], ['/ar-EG'], ['/en'], ['/robots.txt'], ['/sitemap.xml']])('no robots rule touches %s', (path) => {
    expect(robotsRulesFor(path)).toEqual([]);
  });

  it('the matcher reads placeholders and splats (control)', () => {
    expect(matches('/:locale/login', '/ar-EG/login')).toBe(true);
    expect(matches('/:locale/login', '/ar-EG/x/login')).toBe(false);
    expect(matches('/og/*', '/og/og.en.png')).toBe(true);
  });
});

describe('the security block of public/_headers', () => {
  const rules = headerRules();
  const security = rules.find((rule) => rule.pattern === '/*');

  it('is the first block, for every path', () => {
    expect(rules[0]?.pattern).toBe('/*');
  });

  it('says exactly what lib/http/security-headers.ts says', () => {
    expect(security?.headers).toEqual(lowerCased(STATIC_ASSET_SECURITY_HEADERS));
  });

  it('is the only block that sets any of its headers (no comma-joined duplicates)', () => {
    const names = Object.keys(security?.headers ?? {});
    const elsewhere = rules.filter((rule) => rule !== security).flatMap((rule) => Object.keys(rule.headers));
    expect(elsewhere.filter((name) => names.includes(name))).toEqual([]);
  });
});
