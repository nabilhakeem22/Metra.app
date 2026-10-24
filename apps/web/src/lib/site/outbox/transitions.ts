// How outbox records change (Stage 3 site app, plan C2): after an attempt that
// did not finish its op, after a sign-in, and when the engineer retries a
// parked op. PURE and CLIENT-SAFE: the runner saves what these return. A
// finished op leaves the outbox (or, for a photo, moves to its next step),
// which is the runner's to do with the answer's data.
import { recordsOnDependencyCycle } from './dependencies';
import { backoffMs, type AttemptVerdict } from './drain';
import type { OutboxError, OutboxRecord } from './types';

/**
 * The verdicts that change only the attempted record. `device_revoked` changes
 * every record of its studio: parkedForRevokedDevice.
 */
export type RecordFailureVerdict = Exclude<AttemptVerdict, 'done' | 'device_revoked'>;

/** The error a dependency cycle parks its ops with: they were malformed when made. */
const DEPENDENCY_CYCLE_ERROR: OutboxError = { status: 0, code: 'malformed' };

function parked(record: OutboxRecord, lastError: OutboxError): OutboxRecord {
  return { ...record, state: 'needs_attention', attempts: record.attempts + 1, lastError };
}

/**
 * The record after a failed attempt at `now`. retry waits its backoff;
 * needs_attention parks it until the engineer retries or discards it;
 * pause_auth parks it for sign-in without counting a failure (the op was never
 * judged), which pauses the whole queue; refresh_upload sends a photo back to
 * presign for fresh URLs, and parks any other op, which cannot presign.
 */
export function afterFailedAttempt(
  record: OutboxRecord,
  verdict: RecordFailureVerdict,
  lastError: OutboxError,
  now: number,
  random: () => number,
): OutboxRecord {
  switch (verdict) {
    case 'retry':
      return { ...record, state: 'queued', attempts: record.attempts + 1, nextAttemptAt: now + backoffMs(record.attempts, random), lastError };
    case 'needs_attention':
      return parked(record, lastError);
    case 'pause_auth':
      return { ...record, state: 'paused_auth', nextAttemptAt: now, lastError };
    case 'refresh_upload': {
      if (record.op.kind !== 'photo') return parked(record, lastError);
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

/**
 * After a 401 `device_revoked` on `revoked`: every record of that user in that
 * studio that is not already parked, parked with that answer (the engineer sees
 * why: this phone was removed from the studio). No failure is counted, and the
 * user's records in other studios are untouched.
 */
export function parkedForRevokedDevice(records: readonly OutboxRecord[], revoked: OutboxRecord, lastError: OutboxError): OutboxRecord[] {
  return records
    .filter((record) => record.userId === revoked.userId && record.orgId === revoked.orgId && record.state !== 'needs_attention')
    .map((record) => ({ ...record, state: 'needs_attention', lastError }));
}

/**
 * The user's records on a dependency cycle (see recordsOnDependencyCycle) that
 * are not parked yet, parked as malformed so the engineer sees them instead of
 * a queue that never moves. The runner applies it before every drain pass.
 */
export function parkedOnDependencyCycle(records: readonly OutboxRecord[], userId: string): OutboxRecord[] {
  return recordsOnDependencyCycle(records, userId)
    .filter((record) => record.state !== 'needs_attention')
    .map((record) => ({ ...record, state: 'needs_attention', lastError: DEPENDENCY_CYCLE_ERROR }));
}

/** After the user signs in again: the records the 401 paused, queued to go at once. */
export function resumedAfterSignIn(records: readonly OutboxRecord[], userId: string, now: number): OutboxRecord[] {
  return records
    .filter((record) => record.userId === userId && record.state === 'paused_auth')
    .map(({ lastError: _paused, ...record }) => ({ ...record, state: 'queued', nextAttemptAt: now }));
}

/**
 * The engineer's retry of a parked op (a refusal that may since have cleared:
 * he was assigned, consent was given, the studio restored his phone): queued
 * to go at once with a fresh attempt count. Retrying a record that is not
 * parked changes nothing, so a double tap is harmless.
 */
export function retriedByUser(record: OutboxRecord, now: number): OutboxRecord {
  if (record.state !== 'needs_attention') return record;
  const { lastError: _refusal, ...rest } = record;
  return { ...rest, state: 'queued', attempts: 0, nextAttemptAt: now };
}
