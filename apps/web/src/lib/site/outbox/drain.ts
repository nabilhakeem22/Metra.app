// The outbox drain's decisions (Stage 3 site app, plan C2): which op goes next,
// what an answer means, and how long to wait before trying again. PURE and
// CLIENT-SAFE; the runner (IndexedDB, fetch, timers) acts on these answers.
//
// Every /api/site call can die of the Workers CPU limit (Cloudflare's error
// 1102 is an HTML page, not our JSON), so anything that is not a coded answer
// from Metra is retried with backoff. Only a coded refusal parks an op, and
// only a refused session pauses the queue. Nothing here ever drops an op.
import { prerequisiteKeys } from './dependencies';
import type { OutboxError, OutboxRecord } from './types';

export type AttemptVerdict = 'done' | 'retry' | 'pause_auth' | 'needs_attention' | 'refresh_upload';

/** The HTTP status of an answer, or 'network' when none came back (offline, timeout, aborted). */
export type AttemptStatus = number | 'network';

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 300_000;
const BACKOFF_JITTER = 0.2;

/** The statuses of a refusal (plan C3): the request was judged and will be judged the same way again. */
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([400, 403, 404, 409, 422]);

/** A coded answer of the site API. Anything else (a refusal without its code too) did not come from Metra's code. */
type SiteAnswer = { ok: true } | { ok: false; error: string };

function readAnswer(body: unknown): SiteAnswer | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { ok, error } = body as Record<string, unknown>;
  if (ok === true) return { ok };
  return ok === false && typeof error === 'string' ? { ok, error } : null;
}

/**
 * What one answer means for its op. 200 with `ok` is done (an `already` too).
 * 401 pauses the queue. 400, 403, 404, 409 and 422 park the op, except 409
 * `photo_not_uploaded`, which presigns again. Everything else retries: 429,
 * 5xx, no answer, any body that is not a coded answer (an HTML 1102 page, a
 * captive portal) and any status outside the site API's map.
 */
export function classify(status: AttemptStatus, body: unknown): AttemptVerdict {
  if (status === 'network') return 'retry';
  const answer = readAnswer(body);
  if (answer === null) return 'retry';
  if (status === 200) return answer.ok ? 'done' : 'retry';
  if (status === 401) return 'pause_auth';
  if (!REFUSAL_STATUSES.has(status)) return 'retry';
  if (status === 409 && !answer.ok && answer.error === 'photo_not_uploaded') return 'refresh_upload';
  return 'needs_attention';
}

/** The error a failed attempt leaves on its record, for the outbox screen. */
export function attemptError(status: AttemptStatus, body: unknown): OutboxError {
  if (status === 'network') return { status: 0, code: 'network' };
  const answer = readAnswer(body);
  if (answer === null) return { status, code: 'unreadable_answer' };
  return { status, code: answer.ok ? 'unexpected_status' : answer.error };
}

/**
 * The wait after a failed attempt, given how many attempts had failed before
 * it: 2 s, 4 s, 8 s... capped at 5 minutes, each within ±20 % so phones that
 * lost the network together do not retry together. Never above the cap.
 */
export function backoffMs(attempts: number, random: () => number): number {
  if (!Number.isInteger(attempts) || attempts < 0) throw new RangeError('backoffMs needs a whole, non-negative attempt count.');
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS);
  const jitter = 1 - BACKOFF_JITTER + 2 * BACKOFF_JITTER * random();
  return Math.round(Math.min(base * jitter, BACKOFF_CAP_MS));
}

/** The user's records in the order they were made; another user's are never sent (a shared phone). */
function queueOf(records: readonly OutboxRecord[], userId: string): OutboxRecord[] {
  return records.filter((record) => record.userId === userId).sort((a, b) => a.seq - b.seq);
}

/** The user's queued records whose prerequisites have all left the outbox; none while the queue is paused. */
function unblocked(records: readonly OutboxRecord[], userId: string): OutboxRecord[] {
  const queue = queueOf(records, userId);
  if (queue.some((record) => record.state === 'paused_auth')) return [];
  const waiting = new Set(queue.map((record) => record.op.key));
  return queue.filter(
    (record) => record.state === 'queued' && prerequisiteKeys(record.op).every((key) => !waiting.has(key)),
  );
}

/** The oldest op that may be sent at `now`, or null. One at a time: the drain is single-flight. */
export function nextRunnable(records: readonly OutboxRecord[], now: number, currentUserId: string): OutboxRecord | null {
  return unblocked(records, currentUserId).find((record) => record.nextAttemptAt <= now) ?? null;
}

/** When the drain should wake for the next op in backoff, or null when nothing is waiting on a timer. */
export function nextAttemptDue(records: readonly OutboxRecord[], currentUserId: string): number | null {
  const due = unblocked(records, currentUserId).map((record) => record.nextAttemptAt);
  return due.length === 0 ? null : Math.min(...due);
}
