import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { seedNewStudioCore } from '@/lib/market-book/seed-core';

// POST: seed the signed-in studio's price book from the market book, as the
// onboarding wizard asks right after sign-up (lib/market-book/seed-request.ts).
// The studio comes from the session (requireOrg re-checks the membership); the
// caller sends nothing. Owners and admins only (price_book create, in the core);
// idempotent, and a second call while the first runs waits for it.
export const dynamic = 'force-dynamic';

const answer = (body: object, status: number) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** A cookie-authenticated write: refuse a request another site's page sent (the browser always sends Origin on a POST). */
function fromThisSite(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!fromThisSite(request)) return answer({ error: 'Forbidden' }, 403);
  if (!(await getSessionUser())) return answer({ error: 'Unauthorized' }, 401);
  const result = await seedNewStudioCore(await requireOrg());
  if (result.ok) return answer({ ok: true, ...result.data }, 200);
  return answer({ ok: false, error: result.error, reference: result.reference }, result.error === 'forbidden' ? 403 : 500);
}
