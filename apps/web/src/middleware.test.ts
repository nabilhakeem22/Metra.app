import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// Round D (R2): a client-page picture is fetched under one fixed locale segment,
// so the middleware must not let it reset the visitor's locale cookie. Pages
// still negotiate the locale as before.

vi.mock('./lib/supabase/middleware', () => ({ updateSession: async (_request: unknown, response: unknown) => response }));

const { middleware } = await import('./middleware');

function get(path: string) {
  return middleware(new NextRequest(`https://app.test${path}`, { headers: { cookie: 'NEXT_LOCALE=en' } }));
}

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

describe('middleware and client-page pictures', () => {
  it.each([['/ar-EG/d/tok/logo'], [`/ar-EG/d/tok/documents/${DOCUMENT_ID}`]])(
    '%s leaves an English visitor\'s locale cookie alone and keeps no-referrer',
    async (path) => {
      const response = await get(path);
      expect(response.cookies.get('NEXT_LOCALE')).toBeUndefined();
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('the client page itself still negotiates the locale (control)', async () => {
    const response = await get('/ar-EG/d/tok');
    expect(response.cookies.get('NEXT_LOCALE')?.value).toBe('ar-EG');
  });
});
