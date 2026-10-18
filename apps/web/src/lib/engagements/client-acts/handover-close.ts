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
import { after } from 'next/server';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { settledWithin } from '@/lib/async/settled-within';
import { resolveSystemContext } from '@/lib/automation/system-context';
import { holdRequestConnectionUntil } from '@/lib/db/request-connection';
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

type CloseOutcome = { closed: boolean } | { failure: unknown };

function outcomeOf(work: Promise<boolean>): Promise<CloseOutcome> {
  return work.then((closed) => ({ closed }), (failure: unknown) => ({ failure }));
}

/** One redacted line for a close that failed; `late` when it failed after its deadline. */
function logFailure(failure: unknown, late: boolean): void {
  console.error(late ? 'handover close by token failed after its deadline:' : 'handover close by token failed:', loggableFailure(failure));
}

/**
 * A close still running at the deadline is NOT a failure (fix round R6): it
 * goes on, its open transaction finishing as the request's connection ends,
 * and on a slow link it commits seconds later. So the deadline logs that it
 * is still running, and the close's own outcome is logged when it settles.
 */
function reportLateOutcome(outcome: Promise<CloseOutcome>): void {
  console.warn('handover close still running past its deadline:', { deadlineMs: HANDOVER_CLOSE_BUDGET_MS });
  void outcome.then((late) => {
    if ('failure' in late) logFailure(late.failure, true);
    else console.warn('handover close finished after its deadline:', { closed: late.closed });
  });
}

/**
 * Close the delivery whose client just confirmed the handover. True only when
 * THIS call closed it within HANDOVER_CLOSE_BUDGET_MS. Never throws and never
 * waits past that; a failure is one redacted log line (no token, no ids), a
 * close still running at the deadline a line saying so and then one with its
 * outcome, and the confirmation stands either way.
 */
export async function closeHandoverByToken(rawToken: string): Promise<boolean> {
  const token = normalizeRawToken(rawToken);
  if (!token) return false;
  const outcome = outcomeOf(closeByHash(hashShareToken(token)));
  if (!(await settledWithin(outcome, HANDOVER_CLOSE_BUDGET_MS))) {
    reportLateOutcome(outcome);
    return false;
  }
  const settled = await outcome;
  if ('closed' in settled) return settled.closed;
  logFailure(settled.failure, false);
  return false;
}

/**
 * The most the client's answer waits for the close (fix round F7). The close
 * runs ALONGSIDE the studio notification, so the answer waits for the slower
 * of the two; a close still running at this point finishes after the response
 * where the platform allows it, and the hourly closer is the backstop either
 * way. Measured at a 31 ms round trip the close takes about 1.4 s, so it
 * normally lands before the page's refresh reads the delivery.
 */
export const HANDOVER_CLOSE_WAIT_MS = 1_500;

/**
 * Let a close that outran the wait finish after the response (best effort).
 * The close runs on the request's connection, so the connection is held
 * until it settles: the request's teardown would otherwise end it between
 * the close's statements. Never throws.
 */
function finishAfterResponse(closing: Promise<boolean>): void {
  try {
    holdRequestConnectionUntil(closing);
    after(() => closing);
  } catch (err) {
    console.error('handover close not kept past the response:', loggableFailure(err));
  }
}

/**
 * A portal answer, with the delivery closed when it confirmed the handover:
 * the `acknowledge_handoff` verb whose write answered `ok` (a first tap, or
 * `already` on a repeat, which repairs a close that failed). `answer` (the
 * studio notification) runs alongside the close; any other verb or a refusal
 * just runs it. The answer itself is never changed: the client page reads the
 * closed state on the refresh that follows.
 */
export async function withHandoverClose<TAnswer>(
  rawToken: string,
  verb: string,
  written: { ok: boolean },
  answer: () => Promise<TAnswer>,
): Promise<TAnswer> {
  if (verb !== 'acknowledge_handoff' || !written.ok) return answer();
  const closing = closeHandoverByToken(rawToken);
  const [result, settled] = await Promise.all([answer(), settledWithin(closing, HANDOVER_CLOSE_WAIT_MS)]);
  if (!settled) finishAfterResponse(closing);
  return result;
}
