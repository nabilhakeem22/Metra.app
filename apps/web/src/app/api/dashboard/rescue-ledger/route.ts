import { NextResponse } from 'next/server';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { studioReadVerdict } from '@/lib/cf/studio-read-rate-limit';
import { parseRange } from '@/lib/dashboard/range';
import { loadRescueLedgerCore } from '@/lib/dashboard/rescue-ledger/core';
import type { RescueLedgerResponse } from '@/lib/dashboard/rescue-ledger/types';

// GET: the signed-in studio's rescue ledger for the dashboard window
// (`?range=3|6|12`, anything else reads as the default). Its OWN Worker request,
// fetched by the dashboard's island after the page has rendered, so the
// dashboard render does none of this work. Reads only; the studio comes from
// the session (requireOrg re-checks the membership).
//
// `?org=` is the workspace the island was rendered for. When the session's
// active workspace is another one (switched in another tab), the answer is 409
// rather than another workspace's figures under this page's header. Then the
// member's studio read budget (429 past it, lib/cf/studio-read-rate-limit.ts).
export const dynamic = 'force-dynamic';

/** The read budget's period (wrangler.jsonc STUDIO_READ_RATE_LIMITER), in seconds. */
const RETRY_AFTER_SECONDS = '60';

const answer = (body: RescueLedgerResponse, status: number, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

export async function GET(request: Request): Promise<Response> {
  if (!(await getSessionUser())) return answer({ ok: false, error: 'unauthorized' }, 401);
  const params = new URL(request.url).searchParams;
  const range = parseRange(params.get('range') ?? undefined);
  const ctx = await requireOrg();
  if (params.get('org') !== ctx.orgId) return answer({ ok: false, error: 'workspace_changed' }, 409);
  const verdict = await studioReadVerdict(ctx, 'rescue_ledger');
  if (verdict === 'refused') return answer({ ok: false, error: 'rate_limited' }, 429, { 'retry-after': RETRY_AFTER_SECONDS });
  if (verdict === 'misdeployed') return answer(unexpectedFailure('rescue ledger read limiter missing'), 500);
  const result = await loadRescueLedgerCore(ctx, { range });
  if (result.ok) return answer({ ok: true, ledger: result.data }, 200);
  if (result.error === 'forbidden') return answer(result, 403);
  return answer({ ok: false, error: result.error, reference: result.reference }, 500);
}
