import { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { recordWhatsappOpenedCore } from '@/lib/engagements/reminder/whatsapp-opened';
import { fromThisSite } from '@/lib/http/same-site';

// POST { engagementId }: the reminder dialog's "Open WhatsApp" was clicked
// (lib/engagements/reminder/whatsapp-opened-request.ts sends it with keepalive).
// A cookie-authenticated write: this site's pages only, a signed-in studio
// member, the workspace from the session; owner/admin only (in the core).
export const dynamic = 'force-dynamic';

const answer = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

const STATUS: Record<string, number> = { forbidden: 403, malformed: 400, engagement_not_found: 404, flow_not_enabled: 403 };

export async function POST(request: Request): Promise<Response> {
  if (!fromThisSite(request)) return answer({ ok: false, error: 'forbidden' }, 403);
  if (!(await getSessionUser())) return answer({ ok: false, error: 'unauthorized' }, 401);
  const body = (await request.json().catch(() => null)) as { engagementId?: unknown } | null;
  const result = await recordWhatsappOpenedCore(await requireOrg(), body?.engagementId);
  if (result.ok) return answer({ ok: true }, 200);
  return answer({ ok: false, error: result.error, ...(result.reference && { reference: result.reference }) }, STATUS[result.error ?? ''] ?? 500);
}
