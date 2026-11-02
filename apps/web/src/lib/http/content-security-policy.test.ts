import { describe, expect, it } from 'vitest';
import { ENFORCED_CSP, reportOnlyCsp } from './content-security-policy';

const SUPABASE = 'https://ref.supabase.co';
const TURNSTILE = 'https://challenges.cloudflare.com';

describe('the Content Security Policy', () => {
  it('enforces only the four directives that cannot break a Next app', () => {
    expect(ENFORCED_CSP).toBe("frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  });

  it('reports the full fetch policy with the Supabase origin on images and connections, and no Turnstile origin', () => {
    expect(reportOnlyCsp([SUPABASE])).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        `img-src 'self' data: blob: ${SUPABASE}; font-src 'self' data:; connect-src 'self' ${SUPABASE}; ` +
        "frame-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
    );
  });

  it('is exactly the static-asset policy with no extra origins', () => {
    expect(reportOnlyCsp([])).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; " +
        "worker-src 'self'; manifest-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
    );
    expect(reportOnlyCsp([])).not.toContain(TURNSTILE);
  });

  it('allows the Turnstile origin only in script-src and frame-src, and only when asked (the login pages)', () => {
    const policy = reportOnlyCsp([], { turnstile: true });
    expect(policy).toContain(`script-src 'self' 'unsafe-inline' ${TURNSTILE};`);
    expect(policy).toContain(`frame-src 'self' ${TURNSTILE};`);
    expect(policy.split(TURNSTILE)).toHaveLength(3);
    expect(reportOnlyCsp([SUPABASE], { turnstile: true })).toBe(
      reportOnlyCsp([SUPABASE]).replace("script-src 'self' 'unsafe-inline';", `script-src 'self' 'unsafe-inline' ${TURNSTILE};`).replace("frame-src 'self';", `frame-src 'self' ${TURNSTILE};`),
    );
  });

  it('drops the extra origins and their space when there are none', () => {
    const policy = reportOnlyCsp([]);
    expect(policy).toContain("img-src 'self' data: blob:;");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).not.toMatch(/ {2}| ;/);
  });
});
