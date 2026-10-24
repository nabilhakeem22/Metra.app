import { describe, expect, it } from 'vitest';
import { checkIn, ENGINEER, note, OTHER_ENGINEER, photo, queued } from '@/test/site-outbox-records';
import { afterFailedAttempt, resumedAfterSignIn } from './transitions';

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

  it('refresh_upload on anything but a photo is a caller bug', () => {
    expect(() => afterFailedAttempt(queued(note('n1', 'v1')), 'refresh_upload', { status: 409, code: 'photo_not_uploaded' }, NOW, middle)).toThrow(
      RangeError,
    );
  });

  it('never changes the record it was given', () => {
    const record = queued(checkIn('v1'));
    const copy = structuredClone(record);
    afterFailedAttempt(record, 'retry', { status: 0, code: 'network' }, NOW, middle);
    expect(record).toEqual(copy);
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
