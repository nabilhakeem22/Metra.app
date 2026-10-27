import { describe, expect, it } from 'vitest';
import { ENFORCED_CSP, reportOnlyCsp } from './content-security-policy';

const SUPABASE = 'https://ref.supabase.co';
const TURNSTILE = 'https://challenges.cloudflare.com';

describe('the Content Security Policy', () => {
  it('enforces only the four directives that cannot break a Next app', () => {
    expect(ENFORCED_CSP).toBe("frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  });

  it('reports the full fetch policy with the Supabase origin on images and connections', () => {
    expect(reportOnlyCsp([SUPABASE])).toBe(
      `default-src 'self'; script-src 'self' 'unsafe-inline' ${TURNSTILE}; style-src 'self' 'unsafe-inline'; ` +
        `img-src 'self' data: blob: ${SUPABASE}; font-src 'self' data:; connect-src 'self' ${SUPABASE}; ` +
        `frame-src 'self' ${TURNSTILE}; worker-src 'self'; manifest-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'`,
    );
  });

  it('is exactly the static-asset policy with no extra origins, the sign-in widget allowed (Turnstile)', () => {
    expect(reportOnlyCsp([])).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https://challenges.cloudflare.com; " +
        "worker-src 'self'; manifest-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
    );
  });

  it('drops the extra origins and their space when there are none', () => {
    const policy = reportOnlyCsp([]);
    expect(policy).toContain("img-src 'self' data: blob:;");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).not.toMatch(/ {2}| ;/);
  });
});
