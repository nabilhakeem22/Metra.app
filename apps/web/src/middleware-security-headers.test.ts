import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// S6 (go-live security): whatever branch the middleware takes (a client-page
// picture, a client link, a next-intl redirect, a session refresh), the
// response carries exactly its profile's security headers
// (lib/http/security-headers.ts), beside the SEO noindex header.

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
}));
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'fake-anon-key');

const { middleware } = await import('./middleware');
const { securityHeadersFor } = await import('./lib/http/security-headers');

const SUPABASE = ['https://ref.supabase.test'];
const EVERY_SECURITY_HEADER = Object.keys(securityHeadersFor('page', SUPABASE));

function get(path: string, cookie?: string) {
  return middleware(new NextRequest(`https://app.test${path}`, { headers: cookie ? { cookie } : {} }));
}

describe('the security headers on every middleware branch', () => {
  it.each([
    ['a client-page picture', '/ar-EG/d/tok/logo', undefined, 'file'],
    ['a client document', '/ar-EG/d/tok/documents/11111111-1111-4111-8111-111111111111', undefined, 'file'],
    ['a client link', '/en/d/abc', undefined, 'token_page'],
    ['an invite link', '/en/invite/x', undefined, 'token_page'],
    ['a proposal link', '/ar-EG/p/xyz', undefined, 'token_page'],
    ['a next-intl redirect', '/login', undefined, 'page'],
    ['a session refresh', '/en/dashboard', 'sb-ref-auth-token=x', 'page'],
    ['a signed-out studio page', '/en/dashboard', undefined, 'page'],
    ['the landing', '/en', undefined, 'page'],
  ] as const)('%s (%s) gets the %s set, exactly', async (_branch, path, cookie, profile) => {
    const response = await get(path, cookie);
    const expected = securityHeadersFor(profile, SUPABASE);
    for (const name of EVERY_SECURITY_HEADER) expect(response.headers.get(name), name).toBe(expected[name] ?? null);
  });

  it('keeps the noindex header beside them, and none on the landing', async () => {
    expect((await get('/en/invite/x')).headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect((await get('/en')).headers.get('x-robots-tag')).toBeNull();
  });
});
