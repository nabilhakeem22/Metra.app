import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configuredRateLimits, WEB_ROOT } from '@/test/wrangler-rate-limits';

// Round D (W7): the Rate Limiting bindings in apps/web/wrangler.jsonc are the
// ones the code asks for. A binding the code names but the config lacks is a
// refused surface on Cloudflare (a missing binding throws), so this catches it
// before a deploy does. The portal READ ceiling is an open owner decision, so it
// is checked for shape only; changing it stays a one-line config change.

/** Every `*_RATE_LIMITER` binding name the limiter modules ask for. */
function bindingNamesInCode(): string[] {
  const files = ['src/lib/api/rate-limit.ts', 'src/lib/share/portal-rate-limit.ts', 'src/lib/cf/studio-read-rate-limit.ts', 'src/lib/auth/otp-throttle.ts'];
  const names = files.flatMap((file) =>
    [...readFileSync(resolve(WEB_ROOT, file), 'utf8').matchAll(/'([A-Z_]+_RATE_LIMITER)'/g)].map((match) => match[1]),
  );
  return [...new Set(names)].sort();
}

describe('wrangler.jsonc ratelimits', () => {
  const entries = configuredRateLimits();

  it('declares the eight bindings, each over 60 seconds', () => {
    expect(entries.map(({ name, simple }) => [name, simple.period])).toEqual([
      ['API_RATE_LIMITER', 60],
      ['API_PREAUTH_RATE_LIMITER', 60],
      ['PORTAL_ACT_RATE_LIMITER', 60],
      ['PORTAL_READ_RATE_LIMITER', 60],
      ['STUDIO_READ_RATE_LIMITER', 60],
      ['STUDIO_SEARCH_RATE_LIMITER', 60],
      ['AUTH_OTP_IP_RATE_LIMITER', 60],
      ['AUTH_OTP_IDENTIFIER_RATE_LIMITER', 60],
    ]);
  });

  it('keeps the settled ceilings, and a whole positive READ ceiling', () => {
    const ceiling = (name: string) => entries.find((entry) => entry.name === name)?.simple.limit;
    expect([ceiling('API_RATE_LIMITER'), ceiling('API_PREAUTH_RATE_LIMITER'), ceiling('PORTAL_ACT_RATE_LIMITER'), ceiling('STUDIO_READ_RATE_LIMITER'), ceiling('STUDIO_SEARCH_RATE_LIMITER')]).toEqual([100, 300, 30, 30, 120]);
    expect([ceiling('AUTH_OTP_IP_RATE_LIMITER'), ceiling('AUTH_OTP_IDENTIFIER_RATE_LIMITER')]).toEqual([10, 5]);
    expect(Number.isInteger(ceiling('PORTAL_READ_RATE_LIMITER'))).toBe(true);
    expect(ceiling('PORTAL_READ_RATE_LIMITER')).toBeGreaterThan(0);
  });

  it('gives every binding its own integer namespace id', () => {
    const ids = entries.map((entry) => entry.namespace_id);
    for (const id of ids) expect(id).toMatch(/^[1-9][0-9]*$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares exactly the bindings the code asks for', () => {
    expect(bindingNamesInCode()).toEqual(entries.map((entry) => entry.name).sort());
  });
});
