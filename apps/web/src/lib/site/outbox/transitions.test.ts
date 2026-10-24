import { describe, expect, it } from 'vitest';
import { checkIn, ENGINEER, material, note, OTHER_ENGINEER, photo, queued, voidOf } from '@/test/site-outbox-records';
import { afterFailedAttempt, parkedForRevokedDevice, parkedOnDependencyCycle, resumedAfterSignIn, retriedByUser } from './transitions';

const NOW = 1_000_000;
const middle = () => 0.5;
const upload = {
  display: { url: 'https://r2.example/d', headers: { 'content-type': 'image/jpeg' as const } },
  thumb: { url: 'https://r2.example/t', headers: { 'content-type': 'image/jpeg' as const } },
  expiresAt: '2026-10-23T07:20:00Z',
};

describe('afterFailedAttempt', () => {
  it('retry counts the failure and waits its backoff', () => {
    const record = queued(checkIn('v1'));
    const first = afterFailedAttempt(record, 'retry', { status: 503, code: 'unreadable_answer' }, NOW, middle);
    expect(first).toMatchObject({ state: 'queued', attempts: 1, nextAttemptAt: NOW + 2000, lastError: { status: 503 } });
    const second = afterFailedAttempt(first, 'retry', { status: 0, code: 'network' }, NOW, middle);
    expect(second).toMatchObject({ attempts: 2, nextAttemptAt: NOW + 4000, lastError: { code: 'network' } });
  });

  it('needs_attention parks the op with the refusal and keeps everything it carried', () => {
    const record = queued(note('n1', 'v1'));
    const parked = afterFailedAttempt(record, 'needs_attention', { status: 422, code: 'check_fields' }, NOW, middle);
    expect(parked).toMatchObject({ state: 'needs_attention', attempts: 1, op: record.op, lastError: { code: 'check_fields' } });
  });

  it('pause_auth parks the op for sign-in without counting a failure', () => {
    const record = queued(checkIn('v1'), { attempts: 2 });
    const paused = afterFailedAttempt(record, 'pause_auth', { status: 401, code: 'unauthorized' }, NOW, middle);
    expect(paused).toMatchObject({ state: 'paused_auth', attempts: 2, op: record.op });
  });

  it('refresh_upload sends a photo back to presign and forgets the expired URLs', () => {
    const shot = photo('p1', 'v1');
    const record = queued({ ...shot, step: 'confirm', upload });
    const refreshed = afterFailedAttempt(record, 'refresh_upload', { status: 409, code: 'photo_not_uploaded' }, NOW, middle);
    expect(refreshed.state).toBe('queued');
    expect(refreshed.attempts).toBe(1);
    expect(refreshed.nextAttemptAt).toBe(NOW + 2000);
    expect(refreshed.op).toEqual({ ...shot, step: 'presign' });
    expect('upload' in refreshed.op).toBe(false);
  });

  // F4 (S1 functional test): this used to throw, which broke the runner step instead of parking the op.
  it('refresh_upload on anything but a photo parks it, since only a photo can presign', () => {
    const lastError = { status: 409, code: 'photo_not_uploaded' };
    for (const op of [note('n1', 'v1'), material('m9', 'v9', 'p9'), checkIn('v1')]) {
      const record = queued(op);
      expect(afterFailedAttempt(record, 'refresh_upload', lastError, NOW, middle)).toEqual({ ...record, state: 'needs_attention', attempts: 1, lastError });
    }
  });

  it('never changes the record it was given', () => {
    const record = queued(checkIn('v1'));
    const copy = structuredClone(record);
    afterFailedAttempt(record, 'retry', { status: 0, code: 'network' }, NOW, middle);
    expect(record).toEqual(copy);
  });
});

// F1 (S1 functional test): a revoked device parks its own studio's ops only.
describe('parkedForRevokedDevice', () => {
  const revokedError = { status: 401, code: 'device_revoked' };

  it("parks every record of that user in that studio with the reason, counting no failure", () => {
    const attempted = queued(checkIn('va'), { orgId: 'org-1', attempts: 2 });
    const child = queued(note('na', 'va'), { orgId: 'org-1' });
    const alreadyParked = queued(note('nx', 'va'), { orgId: 'org-1', state: 'needs_attention', lastError: { status: 422, code: 'check_fields' } });
    const otherStudio = queued(checkIn('vb'), { orgId: 'org-2' });
    const otherUser = queued(checkIn('vc'), { orgId: 'org-1', userId: OTHER_ENGINEER });
    expect(parkedForRevokedDevice([attempted, child, alreadyParked, otherStudio, otherUser], attempted, revokedError)).toEqual([
      { ...attempted, state: 'needs_attention', lastError: revokedError },
      { ...child, state: 'needs_attention', lastError: revokedError },
    ]);
  });
});

// F5 (S1 functional test): malformed ops on a cycle are parked instead of queued for ever.
describe('parkedOnDependencyCycle', () => {
  it('parks the queued members of a cycle as malformed, and leaves an already parked one and everything else', () => {
    const selfVoid = queued(voidOf('vv', { kind: 'note', key: 'vv' }));
    const parkedLoop = queued(voidOf('ww', { kind: 'note', key: 'ww' }), { state: 'needs_attention', lastError: { status: 0, code: 'malformed' } });
    const fine = queued(checkIn('v1'));
    expect(parkedOnDependencyCycle([selfVoid, parkedLoop, fine], ENGINEER)).toEqual([
      { ...selfVoid, state: 'needs_attention', lastError: { status: 0, code: 'malformed' } },
    ]);
  });

  it('changes nothing in a well-formed outbox', () => {
    expect(parkedOnDependencyCycle([queued(checkIn('v1')), queued(note('n1', 'v1'))], ENGINEER)).toEqual([]);
  });
});

// F3 (S1 functional test): a refusal that clears later (not_assigned, location_consent_required,
// visit_too_old, device_revoked) used to leave only a discard.
describe('retriedByUser', () => {
  it('queues a parked op to go at once, with a fresh attempt count and no refusal', () => {
    const record = queued(checkIn('v1'), { state: 'needs_attention', attempts: 4, nextAttemptAt: 50, lastError: { status: 403, code: 'not_assigned' } });
    const { lastError: _refusal, ...rest } = record;
    expect(retriedByUser(record, NOW)).toEqual({ ...rest, state: 'queued', attempts: 0, nextAttemptAt: NOW });
  });

  it('changes nothing on a record that is not parked (a double tap)', () => {
    for (const state of ['queued', 'paused_auth'] as const) {
      const record = queued(note('n1', 'v1'), { state, attempts: 2, nextAttemptAt: 99 });
      expect(retriedByUser(record, NOW)).toBe(record);
    }
  });
});

describe('resumedAfterSignIn', () => {
  it("queues exactly the user's paused records, to go at once", () => {
    const paused = queued(checkIn('v1'), { state: 'paused_auth', nextAttemptAt: 5, lastError: { status: 401, code: 'unauthorized' } });
    const parked = queued(note('n1', 'v1'), { state: 'needs_attention' });
    const foreign = queued(checkIn('v9'), { userId: OTHER_ENGINEER, state: 'paused_auth' });
    const resumed = resumedAfterSignIn([paused, parked, foreign], ENGINEER, NOW);
    expect(resumed).toEqual([{ seq: paused.seq, orgId: paused.orgId, userId: ENGINEER, op: paused.op, state: 'queued', attempts: 0, nextAttemptAt: NOW }]);
  });
});
