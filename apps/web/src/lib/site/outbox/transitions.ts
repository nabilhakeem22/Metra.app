// How an outbox record changes after an attempt that did not finish it (Stage 3
// site app, plan C2). PURE and CLIENT-SAFE: the runner saves what these return.
// A finished op leaves the outbox (or, for a photo, moves to its next step),
// which is the runner's to do with the answer's data.
import { backoffMs, type AttemptVerdict } from './drain';
import type { OutboxError, OutboxRecord } from './types';

export type FailedVerdict = Exclude<AttemptVerdict, 'done'>;

/**
 * The record after a failed attempt at `now`. retry waits its backoff;
 * needs_attention parks it until the engineer discards it; pause_auth parks the
 * whole queue without counting a failure (the op was never judged);
 * refresh_upload sends a photo back to presign, for fresh URLs.
 */
export function afterFailedAttempt(
  record: OutboxRecord,
  verdict: FailedVerdict,
  lastError: OutboxError,
  now: number,
  random: () => number,
): OutboxRecord {
  switch (verdict) {
    case 'retry':
      return { ...record, state: 'queued', attempts: record.attempts + 1, nextAttemptAt: now + backoffMs(record.attempts, random), lastError };
    case 'needs_attention':
      return { ...record, state: 'needs_attention', attempts: record.attempts + 1, lastError };
    case 'pause_auth':
      return { ...record, state: 'paused_auth', nextAttemptAt: now, lastError };
    case 'refresh_upload': {
      if (record.op.kind !== 'photo') throw new RangeError('Only a photo op can presign again.');
      const { upload: _expired, ...op } = record.op;
      return {
        ...record,
        op: { ...op, step: 'presign' },
        state: 'queued',
        attempts: record.attempts + 1,
        nextAttemptAt: now + backoffMs(record.attempts, random),
        lastError,
      };
    }
  }
}

/** After the user signs in again: the records the 401 paused, queued to go at once. */
export function resumedAfterSignIn(records: readonly OutboxRecord[], userId: string, now: number): OutboxRecord[] {
  return records
    .filter((record) => record.userId === userId && record.state === 'paused_auth')
    .map(({ lastError: _paused, ...record }) => ({ ...record, state: 'queued', nextAttemptAt: now }));
}
