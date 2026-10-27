import { NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { ENFORCED_CSP, reportOnlyCsp } from './content-security-policy';

// S6 (go-live security): the profile a path gets, the exact header set of each
// profile, and the per-request cost. The Supabase origin is read once, at import.

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co/');
const { securityHeaderProfileOf, securityHeadersFor, STATIC_ASSET_SECURITY_HEADERS, withSecurityHeaders } = await import('./security-headers');

const COMMON = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};
const PERMISSIONS = 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()';

describe('securityHeaderProfileOf', () => {
  it.each([
    ['/en/dashboard', 'page'],
    ['/ar-EG/d/abc', 'token_page'],
    ['/en/p/abc', 'token_page'],
    ['/en/invite/abc', 'token_page'],
    ['/ar-EG/c/abc/x', 'token_page'],
    ['/ar-EG/d/abc/logo', 'file'],
    ['/ar-EG/d/abc/documents/123', 'file'],
    ['/en/display', 'page'],
    ['/en/projects/p', 'page'],
    ['/en', 'page'],
    ['/', 'page'],
  ])('%s is %s', (path, profile) => {
    expect(securityHeaderProfileOf(path)).toBe(profile);
  });
});

describe('securityHeadersFor', () => {
  it('gives a page the full set, with Referer kept to the origin', () => {
    expect(securityHeadersFor('page', ['https://s.test'])).toEqual({
      ...COMMON,
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': PERMISSIONS,
      'Content-Security-Policy': ENFORCED_CSP,
      'Content-Security-Policy-Report-Only': reportOnlyCsp(['https://s.test']),
    });
  });

  it('gives a token page the same set with no Referer at all', () => {
    expect(securityHeadersFor('token_page', [])).toEqual({ ...securityHeadersFor('page', []), 'Referrer-Policy': 'no-referrer' });
  });

  it('gives a file no CSP and no Permissions-Policy', () => {
    expect(securityHeadersFor('file', ['https://s.test'])).toEqual({ ...COMMON, 'Referrer-Policy': 'no-referrer' });
  });

  it('describes static assets as a page with no extra origin', () => {
    expect(STATIC_ASSET_SECURITY_HEADERS).toEqual(securityHeadersFor('page', []));
  });
});

describe('withSecurityHeaders', () => {
  it('sets the profile set, with the Supabase origin in the Report-Only policy', () => {
    const response = withSecurityHeaders(NextResponse.next(), '/en/p/abc');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy-report-only')).toBe(reportOnlyCsp(['https://ref.supabase.co']));
  });

  it.each(['/en/dashboard', '/en/login', '/ar-EG/d/abc', '/nope.png'])('gives %s no Turnstile origin: only the static login assets use the widget', (path) => {
    const policy = withSecurityHeaders(NextResponse.next(), path).headers.get('content-security-policy-report-only');
    expect(policy).not.toContain('challenges.cloudflare.com');
  });

  it('replaces a header a branch already set, never comma-joins it', () => {
    const response = NextResponse.next();
    response.headers.set('Referrer-Policy', 'no-referrer');
    expect(withSecurityHeaders(response, '/en/dashboard').headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('costs under 20 microseconds a call (no per-request rebuild)', () => {
    const response = NextResponse.next();
    const paths = ['/en/dashboard', '/ar-EG/d/abc', '/ar-EG/d/abc/logo'];
    const calls = 10_000;
    const started = performance.now();
    for (let index = 0; index < calls; index += 1) withSecurityHeaders(response, paths[index % 3]);
    expect(((performance.now() - started) * 1000) / calls).toBeLessThan(20);
  });
});
