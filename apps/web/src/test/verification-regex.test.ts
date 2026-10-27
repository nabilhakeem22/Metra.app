import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERIFICATION_TOKEN } from '@/lib/seo/site-verification';
import { WEB_ROOT } from './wrangler-rate-limits';

// The verification tags reach two places: the landing metadata
// (lib/seo/site-verification.ts, at build time) and the "/" redirector page
// (scripts/emit-static-pages.mjs, after the build). A plain .mjs build script
// cannot import the TypeScript module, so it holds its own copy of the token
// regex; this keeps the two copies equal.

const emitScript = readFileSync(resolve(WEB_ROOT, 'scripts/emit-static-pages.mjs'), 'utf8');

describe('the site-verification token regex', () => {
  it('is the same literal in emit-static-pages.mjs as in site-verification.ts', () => {
    const literal = /const VERIFICATION_TOKEN = \/(.+)\/([a-z]*);/.exec(emitScript);
    expect(literal, 'emit-static-pages.mjs declares VERIFICATION_TOKEN').not.toBeNull();
    expect(literal?.[1]).toBe(VERIFICATION_TOKEN.source);
    expect(literal?.[2]).toBe(VERIFICATION_TOKEN.flags);
  });

  it('reads the same two variables in both places', () => {
    expect(emitScript).toContain("'NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION'");
    expect(emitScript).toContain("'NEXT_PUBLIC_BING_SITE_VERIFICATION'");
  });
});
