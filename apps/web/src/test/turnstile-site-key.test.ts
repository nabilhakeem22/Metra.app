import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TURNSTILE_SITE_KEY_VARIABLE, turnstileSiteKey } from '../../scripts/turnstile-site-key.mjs';
import { WEB_ROOT } from './wrangler-rate-limits';

// One rule for the sign-in Turnstile site key, read by the build gate in
// next.config.mjs and by the login form's captcha hook. Cloudflare's published
// test keys stand in for real ones; a secret key is longer, so it fails.

const SECRET_SHAPED = '1x0000000000000000000000000000000AA';

describe('turnstileSiteKey', () => {
  it.each([[undefined], [''], ['   ']])('is absent for a blank value %j', (value) => {
    expect(turnstileSiteKey(value)).toBeUndefined();
  });

  it('returns a site key as given', () => {
    expect(turnstileSiteKey('1x00000000000000000000AA')).toBe('1x00000000000000000000AA');
  });

  it('returns a site key trimmed', () => {
    expect(turnstileSiteKey(' 0x4AAAAAAAAAAAAAAAAAAAAA ')).toBe('0x4AAAAAAAAAAAAAAAAAAAAA');
  });

  it.each([
    ['a secret key', SECRET_SHAPED],
    ['markup', '<script>'],
    ['an inner space', '1x0000000000 0000000000AA'],
  ])('refuses %s, naming the variable and the fix but not the value', (_label, value) => {
    expect(() => turnstileSiteKey(value)).toThrow(TURNSTILE_SITE_KEY_VARIABLE);
    expect(() => turnstileSiteKey(value)).toThrow('never the secret key');
    expect(() => turnstileSiteKey(value)).not.toThrow(value);
  });

  it('names the variable the workflows and the hook read', () => {
    expect(TURNSTILE_SITE_KEY_VARIABLE).toBe('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  });
});

describe('the readers of the rule', () => {
  it('next.config.mjs runs it on the variable at build time', () => {
    const nextConfig = readFileSync(resolve(WEB_ROOT, 'next.config.mjs'), 'utf8');
    expect(nextConfig).toContain("from './scripts/turnstile-site-key.mjs'");
    expect(nextConfig).toContain('turnstileSiteKey(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)');
  });

  it('the captcha hook reads the variable literally, so Next inlines it into the client chunk', () => {
    const hook = readFileSync(resolve(WEB_ROOT, 'src/app/[locale]/(auth)/login/use-captcha.ts'), 'utf8');
    expect(hook).toContain('turnstileSiteKey(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)');
  });
});
