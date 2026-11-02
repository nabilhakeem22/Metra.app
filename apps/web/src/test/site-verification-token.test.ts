import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BING_VARIABLE, GOOGLE_VARIABLE, verificationToken } from '../../scripts/site-verification-token.mjs';
import { WEB_ROOT } from './wrangler-rate-limits';

// One rule for the Search Console / Bing tokens, read by three places: the
// landing metadata (lib/seo/site-verification.ts), the build gate in
// next.config.mjs and the post-build step scripts/emit-static-pages.mjs. This
// pins the rule, the message the owner sees, and that no reader keeps a copy.

describe('verificationToken', () => {
  it.each([[undefined], [''], ['   ']])('is absent for a blank value %j', (value) => {
    expect(verificationToken(GOOGLE_VARIABLE, value)).toBeUndefined();
  });

  it('returns the trimmed token', () => {
    expect(verificationToken(BING_VARIABLE, ' ABCDEF0123456789 ')).toBe('ABCDEF0123456789');
  });

  it.each([
    ['a whole meta tag', '<meta name="google-site-verification" content="abcdefghij0123">'],
    ['a stray quote', 'abcdefghij0123"'],
    ['an inner space', 'abcdefghij 0123'],
    ['9 characters', 'a'.repeat(9)],
    ['101 characters', 'a'.repeat(101)],
  ])('refuses %s, naming the variable and the fix but not the value', (_label, value) => {
    expect(() => verificationToken(GOOGLE_VARIABLE, value)).toThrow(GOOGLE_VARIABLE);
    expect(() => verificationToken(GOOGLE_VARIABLE, value)).toThrow('not the whole meta tag');
    expect(() => verificationToken(GOOGLE_VARIABLE, value)).not.toThrow(value);
  });
});

describe('the readers of the rule', () => {
  const sharedImport = "from './site-verification-token.mjs'";

  it('next.config.mjs and emit-static-pages.mjs import it and keep no regex of their own', () => {
    const nextConfig = readFileSync(resolve(WEB_ROOT, 'next.config.mjs'), 'utf8');
    const emitScript = readFileSync(resolve(WEB_ROOT, 'scripts/emit-static-pages.mjs'), 'utf8');
    expect(nextConfig).toContain("from './scripts/site-verification-token.mjs'");
    expect(emitScript).toContain(sharedImport);
    for (const source of [nextConfig, emitScript]) expect(source).not.toContain('A-Za-z0-9_-');
  });

  it('the metadata builder imports it and keeps no regex of its own', () => {
    const builder = readFileSync(resolve(WEB_ROOT, 'src/lib/seo/site-verification.ts'), 'utf8');
    expect(builder).toContain("from '../../../scripts/site-verification-token.mjs'");
    expect(builder).not.toContain('A-Za-z0-9_-');
  });
});
