import { describe, expect, it } from 'vitest';
import { checkIn, checkOut, ENGINEER, material, note, OTHER_ENGINEER, photo, queued } from '@/test/site-outbox-records';
import { attemptError, backoffMs, classify, nextAttemptDue, nextRunnable } from './drain';

const CF_1102_PAGE = '<!DOCTYPE html><html><head><title>Worker exceeded resource limits | Cloudflare</title></head><body>Error 1102</body></html>';

describe('classify', () => {
  it('200 with ok is done, with or without already', () => {
    expect(classify(200, { ok: true })).toBe('done');
    expect(classify(200, { ok: true, already: true, visit: { id: 'x' } })).toBe('done');
  });

  it('401 device_revoked is its own verdict; any other coded 401 pauses the queue', () => {
    expect(classify(401, { ok: false, error: 'device_revoked' })).toBe('device_revoked');
    expect(classify(401, { ok: false, error: 'unauthorized' })).toBe('pause_auth');
    expect(classify(401, { ok: false, error: 'generic' })).toBe('pause_auth');
  });

  it.each([
    [400, 'malformed'],
    [403, 'not_assigned'],
    [404, 'visit_not_found'],
    [409, 'visit_too_old'],
    [422, 'check_fields'],
  ] as const)('%i %s parks the op as needs_attention', (status, error) => {
    expect(classify(status, { ok: false, error })).toBe('needs_attention');
  });

  it('409 photo_not_uploaded presigns again instead', () => {
    expect(classify(409, { ok: false, error: 'photo_not_uploaded' })).toBe('refresh_upload');
  });

  it.each([429, 500, 502, 503])('%i with a coded answer retries', (status) => {
    expect(classify(status, { ok: false, error: 'rate_limited' })).toBe('retry');
  });

  it('no answer at all retries', () => {
    expect(classify('network', undefined)).toBe('retry');
  });

  it('an HTML 1102 page retries, whatever its status (a CPU kill is never a refusal)', () => {
    expect(classify(503, CF_1102_PAGE)).toBe('retry');
    expect(classify(500, CF_1102_PAGE)).toBe('retry');
    expect(classify(403, CF_1102_PAGE)).toBe('retry');
    expect(classify(200, CF_1102_PAGE)).toBe('retry');
  });

  it('a body that is not a coded answer retries rather than parking or finishing the op', () => {
    for (const body of [null, undefined, '', [], { error: 'forbidden' }, { ok: 'true' }, { ok: false }, { ok: false, error: 7 }]) {
      expect(classify(200, body)).toBe('retry');
      expect(classify(422, body)).toBe('retry');
    }
  });

  it('a 200 that says not ok is not trusted as done', () => {
    expect(classify(200, { ok: false, error: 'generic' })).toBe('retry');
  });

  it('a status outside the map retries', () => {
    expect(classify(302, { ok: false, error: 'generic' })).toBe('retry');
    expect(classify(408, { ok: false, error: 'generic' })).toBe('retry');
    expect(classify(413, { ok: false, error: 'malformed' })).toBe('retry');
    expect(classify(204, { ok: true })).toBe('retry');
  });
});

describe('attemptError', () => {
  it('keeps the coded error of an answer', () => {
    expect(attemptError(422, { ok: false, error: 'check_fields' })).toEqual({ status: 422, code: 'check_fields' });
  });

  it('names a missing answer and an unreadable one', () => {
    expect(attemptError('network', undefined)).toEqual({ status: 0, code: 'network' });
    expect(attemptError(503, CF_1102_PAGE)).toEqual({ status: 503, code: 'unreadable_answer' });
  });

  it('a refusal without its code is unreadable, and an ok answer at another status is unexpected', () => {
    expect(attemptError(500, { ok: false })).toEqual({ status: 500, code: 'unreadable_answer' });
    expect(attemptError(204, { ok: true })).toEqual({ status: 204, code: 'unexpected_status' });
  });
});

describe('backoffMs', () => {
  const middle = () => 0.5;

  it('doubles from 2 s', () => {
    expect([0, 1, 2, 3, 4].map((attempts) => backoffMs(attempts, middle))).toEqual([2000, 4000, 8000, 16000, 32000]);
  });

  it('stays within ±20 %', () => {
    expect(backoffMs(0, () => 0)).toBe(1600);
    expect(backoffMs(0, () => 0.999999)).toBeLessThanOrEqual(2400);
    expect(backoffMs(1, () => 0)).toBe(3200);
    expect(backoffMs(1, () => 0.999999)).toBeLessThanOrEqual(4800);
  });

  it('never waits more than 5 minutes, however many attempts failed', () => {
    expect(backoffMs(7, middle)).toBe(256_000);
    for (const attempts of [8, 9, 20, 1000, 5000]) {
      expect(backoffMs(attempts, middle)).toBe(300_000);
      expect(backoffMs(attempts, () => 0.999999)).toBe(300_000);
      expect(backoffMs(attempts, () => 0)).toBe(240_000);
    }
  });

  it('refuses an attempt count that is not a whole non-negative number', () => {
    for (const attempts of [-1, 1.5, Number.NaN]) expect(() => backoffMs(attempts, middle)).toThrow(RangeError);
  });
});

describe('nextRunnable', () => {
  it('sends the oldest op first', () => {
    const visit = queued(checkIn('v1'));
    const later = queued(checkIn('v2'));
    expect(nextRunnable([later, visit], 0, ENGINEER)).toBe(visit);
  });

  it('holds every child of a visit until its check-in has left the outbox', () => {
    const visit = queued(checkIn('v1'), { nextAttemptAt: 10_000 });
    const children = [queued(photo('p1', 'v1')), queued(note('n1', 'v1')), queued(material('m1', 'v1')), queued(checkOut('o1', 'v1'))];
    expect(nextRunnable([visit, ...children], 0, ENGINEER)).toBeNull();
    expect(nextRunnable(children, 0, ENGINEER)).toBe(children[0]);
  });

  it('holds a material until the photo it shows has been sent', () => {
    const shot = queued(photo('p1', 'v1'), { state: 'needs_attention' });
    const delivery = queued(material('m1', 'v1', 'p1'));
    expect(nextRunnable([shot, delivery], 0, ENGINEER)).toBeNull();
    expect(nextRunnable([delivery], 0, ENGINEER)).toBe(delivery);
  });

  it('a needs_attention check-in blocks its children, not another visit', () => {
    const parked = queued(checkIn('v1'), { state: 'needs_attention' });
    const child = queued(note('n1', 'v1'));
    const otherVisit = queued(checkIn('v2'));
    expect(nextRunnable([parked, child, otherVisit], 0, ENGINEER)).toBe(otherVisit);
  });

  it('skips an op still in its backoff and sends a later independent one', () => {
    const waiting = queued(checkIn('v1'), { nextAttemptAt: 5_000 });
    const ready = queued(checkIn('v2'));
    expect(nextRunnable([waiting, ready], 1_000, ENGINEER)).toBe(ready);
    expect(nextRunnable([waiting], 5_000, ENGINEER)).toBe(waiting);
  });

  it("never sends another user's records (a shared phone)", () => {
    const foreign = queued(checkIn('v9'), { userId: OTHER_ENGINEER });
    expect(nextRunnable([foreign], 0, ENGINEER)).toBeNull();
  });

  it("another user's pending check-in does not block this user's ops", () => {
    const foreign = queued(checkIn('v1'), { userId: OTHER_ENGINEER });
    const mine = queued(note('n1', 'v1'));
    expect(nextRunnable([foreign, mine], 0, ENGINEER)).toBe(mine);
  });

  it("sends nothing while any of the user's records is paused for sign-in, in any studio", () => {
    const paused = queued(checkIn('v1'), { state: 'paused_auth', orgId: 'org-1' });
    const other = queued(checkIn('v2'), { orgId: 'org-2' });
    expect(nextRunnable([paused, other], 0, ENGINEER)).toBeNull();
  });

  // F1 (S1 functional test): a revoked device used to stop the user's other studios too.
  it("a studio's ops parked for a revoked device do not hold back the user's other studio", () => {
    const revoked = queued(checkIn('va'), { orgId: 'org-1', state: 'needs_attention', lastError: { status: 401, code: 'device_revoked' } });
    const otherStudio = queued(checkIn('vb'), { orgId: 'org-2', nextAttemptAt: 5_000 });
    expect(nextRunnable([revoked, otherStudio], 1e7, ENGINEER)).toBe(otherStudio);
    expect(nextAttemptDue([revoked, otherStudio], ENGINEER)).toBe(5_000);
  });

  it('an empty outbox has nothing to send', () => {
    expect(nextRunnable([], 0, ENGINEER)).toBeNull();
  });
});

describe('nextAttemptDue', () => {
  it('is the earliest backoff among the ops that could go', () => {
    const late = queued(checkIn('v1'), { nextAttemptAt: 9_000 });
    const soon = queued(checkIn('v2'), { nextAttemptAt: 4_000 });
    const blocked = queued(note('n1', 'v1'), { nextAttemptAt: 1_000 });
    expect(nextAttemptDue([late, soon, blocked], ENGINEER)).toBe(4_000);
  });

  it('is null when only parked, paused or foreign records remain', () => {
    expect(nextAttemptDue([queued(checkIn('v1'), { state: 'needs_attention' })], ENGINEER)).toBeNull();
    expect(nextAttemptDue([queued(checkIn('v1'), { state: 'paused_auth' }), queued(checkIn('v2'))], ENGINEER)).toBeNull();
    expect(nextAttemptDue([queued(checkIn('v1'), { userId: OTHER_ENGINEER })], ENGINEER)).toBeNull();
  });
});
