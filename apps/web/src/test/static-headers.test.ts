import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/routing';
import { LOGIN_ASSET_REPORT_ONLY_CSP, STATIC_ASSET_SECURITY_HEADERS } from '@/lib/http/security-headers';
import { WEB_ROOT } from './wrangler-rate-limits';

// public/_headers: the headers Cloudflare adds to responses served as static
// assets (the Worker, and so the middleware, never runs for them). The login
// assets must say noindex; the indexable pages and the crawl files must carry
// no robots rule. The `/*` block is the security set (lib/http/security-headers.ts)
// and must say exactly what the module says; no other block may set one of its
// names, because Cloudflare comma-joins a header two matching rules both set.
// The one exception is the login block: it detaches (`! Name`) the /* Report-Only
// policy before setting its own, which adds the Turnstile origin (only the login
// pages have the widget).

interface HeaderRule { pattern: string; headers: Record<string, string>; detached: string[] }

function headerRules(): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const line of readFileSync(resolve(WEB_ROOT, 'public/_headers'), 'utf8').split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: {}, detached: [] });
      continue;
    }
    if (line.trim().startsWith('! ')) {
      const detaching = rules.at(-1);
      if (!detaching) throw new Error(`public/_headers: a detach line outside a rule: ${line}`);
      detaching.detached.push(line.trim().slice(2).trim().toLowerCase());
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

/** What Cloudflare answers for `path`: each matching rule in order, its detached names removed first, a name two rules both set comma-joined. */
function effectiveHeaders(path: string): Record<string, string> {
  const effective: Record<string, string> = {};
  for (const rule of headerRules().filter((candidate) => matches(candidate.pattern, path))) {
    for (const name of rule.detached) delete effective[name];
    for (const [name, value] of Object.entries(rule.headers)) effective[name] = name in effective ? `${effective[name]}, ${value}` : value;
  }
  return effective;
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

  it('is the only block that sets any of its headers, but for a name the setting block detaches first (no comma-joined duplicates)', () => {
    const names = Object.keys(security?.headers ?? {});
    const undetached = rules
      .filter((rule) => rule !== security)
      .flatMap((rule) => Object.keys(rule.headers).filter((name) => !rule.detached.includes(name)));
    expect(undetached.filter((name) => names.includes(name))).toEqual([]);
  });
});

describe('the Report-Only policy of public/_headers', () => {
  const REPORT_ONLY = 'content-security-policy-report-only';

  it.each(LOCALES.map((locale) => [`/${locale}/login`]))('%s gets ONE policy, the login one with the Turnstile origin', (path) => {
    expect(effectiveHeaders(path)[REPORT_ONLY]).toBe(LOGIN_ASSET_REPORT_ONLY_CSP);
    expect(LOGIN_ASSET_REPORT_ONLY_CSP).toContain('https://challenges.cloudflare.com');
  });

  it.each([['/'], ['/en'], ['/ar-EG'], ['/en/login/x'], ['/landing/feature-flow.en.webp'], ['/nope.png']])(
    '%s gets the static policy with no Turnstile origin',
    (path) => {
      expect(effectiveHeaders(path)[REPORT_ONLY]).toBe(STATIC_ASSET_SECURITY_HEADERS['Content-Security-Policy-Report-Only']);
      expect(effectiveHeaders(path)[REPORT_ONLY]).not.toContain('challenges.cloudflare.com');
    },
  );
});
