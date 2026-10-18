import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { parseRange } from '@/lib/dashboard/range';
import { loadRescueLedgerCore } from '@/lib/dashboard/rescue-ledger/core';
import type { RescueLedgerResponse } from '@/lib/dashboard/rescue-ledger/types';

// GET: the signed-in studio's rescue ledger for the dashboard window
// (`?range=3|6|12`, anything else reads as the default). Its OWN Worker request,
// fetched by the dashboard's island after the page has rendered, so the
// dashboard render does none of this work. Reads only; the studio comes from
// the session (requireOrg re-checks the membership).
export const dynamic = 'force-dynamic';

const answer = (body: RescueLedgerResponse, status: number) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  if (!(await getSessionUser())) return answer({ ok: false, error: 'unauthorized' }, 401);
  const range = parseRange(new URL(request.url).searchParams.get('range') ?? undefined);
  const result = await loadRescueLedgerCore(await requireOrg(), { range });
  if (result.ok) return answer({ ok: true, ledger: result.data }, 200);
  if (result.error === 'forbidden') return answer(result, 403);
  return answer({ ok: false, error: result.error, reference: result.reference }, 500);
}
