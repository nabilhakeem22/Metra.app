import 'server-only';
// The client's handover confirmation closes the design-only delivery IN THE
// SAME REQUEST (Round C, C11). The ending was chosen earlier and explicitly
// (`chooseDesignOnly`); the confirmation completes it through the executor as
// the org's system actor, exactly as the staff path and the hourly closer do
// (../handover-close.ts), so the role gate, the guard (a LIVE acknowledgement)
// and the atomic state move all still run. The hourly closer stays the safety
// net: a close that fails or runs out of time here is repaired within the hour,
// and both are idempotent through the executor's state gate.
import { sql } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { resolveSystemContext } from '@/lib/automation/system-context';
import { withDeadline } from '@/lib/http/deadlines';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { closeAcknowledgedHandover } from '../handover-close';

/** The most the client's answer waits for the close (target read, actor, executor). */
export const HANDOVER_CLOSE_BUDGET_MS = 4_000;

/** What app_delivery_close_target_by_token answered, or null when it is not that shape. */
function closeTargetOf(data: unknown): { orgId: string; engagementId: string } | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  return isUuid(row.org_id) && isUuid(row.engagement_id)
    ? { orgId: row.org_id, engagementId: row.engagement_id }
    : null;
}

async function closeByHash(hash: string): Promise<boolean> {
  const target = closeTargetOf(
    await readSdfJson<unknown>(sql`select public.app_delivery_close_target_by_token(${hash}) as data`),
  );
  // No live link, not at the handover, or no live client acknowledgement.
  if (!target) return false;
  const systemCtx = await resolveSystemContext(target.orgId);
  if (!systemCtx) {
    console.error('handover close by token failed:', { code: 'no_system_actor' });
    return false;
  }
  return (await closeAcknowledgedHandover(systemCtx, target.engagementId, 'client')) === 'closed';
}

/**
 * Close the delivery whose client just confirmed the handover. True only when
 * THIS call closed it. Never throws and never waits past
 * HANDOVER_CLOSE_BUDGET_MS; a failure is one redacted log line (no token, no
 * ids), and the confirmation stands either way.
 */
export async function closeHandoverByToken(rawToken: string): Promise<boolean> {
  const token = normalizeRawToken(rawToken);
  if (!token) return false;
  try {
    return await withDeadline(closeByHash(hashShareToken(token)), HANDOVER_CLOSE_BUDGET_MS, 'handover close');
  } catch (err) {
    console.error('handover close by token failed:', loggableFailure(err));
    return false;
  }
}

/**
 * A portal answer, after closing the delivery when it confirmed the handover:
 * the `acknowledge_handoff` verb answered `ok` (a first tap, or `already` on a
 * repeat, which repairs a close that failed). Any other verb or a refusal
 * passes through untouched. The answer itself is never changed: the client
 * page reads the closed state on the refresh that follows.
 */
export async function closingConfirmedHandover<TAnswer extends { ok: boolean }>(
  rawToken: string,
  verb: string,
  answer: TAnswer,
): Promise<TAnswer> {
  if (verb === 'acknowledge_handoff' && answer.ok) await closeHandoverByToken(rawToken);
  return answer;
}
