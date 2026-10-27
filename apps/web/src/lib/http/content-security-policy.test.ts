import { describe, expect, it } from 'vitest';
import { ENFORCED_CSP, reportOnlyCsp } from './content-security-policy';

const SUPABASE = 'https://ref.supabase.co';

describe('the Content Security Policy', () => {
  it('enforces only the four directives that cannot break a Next app', () => {
    expect(ENFORCED_CSP).toBe("frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  });

  it('reports the full fetch policy with the Supabase origin on images and connections', () => {
    expect(reportOnlyCsp([SUPABASE])).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        `img-src 'self' data: blob: ${SUPABASE}; font-src 'self' data:; connect-src 'self' ${SUPABASE}; ` +
        "frame-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
    );
  });

  it('drops the extra origins and their space when there are none', () => {
    const policy = reportOnlyCsp([]);
    expect(policy).toContain("img-src 'self' data: blob:;");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).not.toMatch(/ {2}| ;/);
  });
});
