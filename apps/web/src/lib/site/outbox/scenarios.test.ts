import { describe, expect, it } from 'vitest';
import { checkIn, checkOut, ENGINEER, material, note, photo, queued, voidOf } from '@/test/site-outbox-records';
import { discardPlan } from './dependencies';
import { attemptError, classify, nextAttemptDue, nextRunnable, type AttemptStatus } from './drain';
import { afterFailedAttempt, parkedForRevokedDevice, parkedOnDependencyCycle, resumedAfterSignIn, retriedByUser } from './transitions';
import type { OutboxRecord, SiteOp } from './types';

// The outbox decisions driven end to end against a fake site API (plan AC20 to
// AC23 at the decision level; the IndexedDB runner repeats them in S4). The fake
// server dedupes on the client key exactly as the real one will
// (`unique (org_id, client_key)`, answering `already`).

const CF_1102_PAGE = '<!DOCTYPE html><html><body>Error 1102: Worker exceeded resource limits</body></html>';

type Fault =
  | 'network'
  | 'cpu_kill_before_commit'
  | 'cpu_kill_after_commit'
  | 'refuse_fields'
  | 'refuse_not_assigned'
  | 'refuse_photo_too_large'
  | 'photo_not_uploaded';

interface Answer {
  status: AttemptStatus;
  body: unknown;
}

class FakeSiteServer {
  online = true;
  sessionValid = true;
  /** The studios that removed this phone: their requests answer 401 device_revoked. */
  readonly revokedOrgs = new Set<string>();
  /** The projects the engineer is assigned to; null assigns him everywhere. */
  assignedProjects: Set<string> | null = null;
  /** Committed rows by client key: what the database would hold. */
  readonly rows = new Map<string, SiteOp>();
  /** Every request that reached the server, in order: [key, clock]. */
  readonly requests: Array<[string, number]> = [];
  private readonly faults = new Map<string, Fault[]>();

  fail(key: string, ...faults: Fault[]): void {
    this.faults.set(key, faults);
  }

  rowsOf(kind: SiteOp['kind']): SiteOp[] {
    return [...this.rows.values()].filter((op) => op.kind === kind);
  }

  handle({ op, orgId }: OutboxRecord, now: number): Answer {
    if (!this.online) return { status: 'network', body: undefined };
    this.requests.push([op.key, now]);
    if (!this.sessionValid) return { status: 401, body: { ok: false, error: 'unauthorized' } };
    if (this.revokedOrgs.has(orgId)) return { status: 401, body: { ok: false, error: 'device_revoked' } };
    if (op.kind === 'check_in' && this.assignedProjects !== null && !this.assignedProjects.has(op.projectId)) {
      return { status: 403, body: { ok: false, error: 'not_assigned' } };
    }
    const fault = this.faults.get(op.key)?.shift();
    if (fault === 'network') return { status: 'network', body: undefined };
    if (fault === 'cpu_kill_before_commit') return { status: 503, body: CF_1102_PAGE };
    if (fault === 'refuse_fields') return { status: 422, body: { ok: false, error: 'check_fields', fields: { body: { code: 'required' } } } };
    if (fault === 'refuse_not_assigned') return { status: 403, body: { ok: false, error: 'not_assigned' } };
    if (fault === 'refuse_photo_too_large') return { status: 422, body: { ok: false, error: 'photo_too_large' } };
    if (fault === 'photo_not_uploaded') return { status: 409, body: { ok: false, error: 'photo_not_uploaded' } };
    if ('visitKey' in op && !this.rows.has(op.visitKey)) return { status: 404, body: { ok: false, error: 'visit_not_found' } };
    const already = this.rows.has(op.key);
    if (!already) this.rows.set(op.key, op);
    if (fault === 'cpu_kill_after_commit') return { status: 503, body: CF_1102_PAGE };
    return { status: 200, body: already ? { ok: true, already: true } : { ok: true } };
  }
}

/** A single-flight drain over an in-memory outbox, on a fake clock, the way the runner will drive it. */
class Drain {
  now = 0;

  constructor(
    readonly outbox: OutboxRecord[],
    private readonly server: FakeSiteServer,
    private readonly random: () => number = Math.random,
  ) {}

  /** Sends until nothing can go at or before `until`, sleeping through backoffs on the fake clock. */
  runUntil(until: number): void {
    for (let step = 0; step < 1000; step++) {
      this.save(parkedOnDependencyCycle(this.outbox, ENGINEER));
      const record = nextRunnable(this.outbox, this.now, ENGINEER);
      if (record === null) {
        const due = nextAttemptDue(this.outbox, ENGINEER);
        if (due === null || due > until) return;
        this.now = Math.max(this.now, due);
        continue;
      }
      const { status, body } = this.server.handle(record, this.now);
      const verdict = classify(status, body);
      const error = attemptError(status, body);
      if (verdict === 'done') this.outbox.splice(this.outbox.indexOf(record), 1);
      else if (verdict === 'device_revoked') this.save(parkedForRevokedDevice(this.outbox, record, error));
      else this.save([afterFailedAttempt(record, verdict, error, this.now, this.random)]);
    }
    throw new Error('The drain did not settle in 1000 steps.');
  }

  /** Writes changed records over their old versions, as the store's `put` does. */
  save(changed: readonly OutboxRecord[]): void {
    for (const record of changed) this.outbox[this.outbox.findIndex(({ seq }) => seq === record.seq)] = record;
  }

  retry(seq: number): void {
    this.save([retriedByUser(this.outbox.find((record) => record.seq === seq)!, this.now)]);
  }

  discard(seq: number): string[] {
    const plan = discardPlan(this.outbox, seq);
    this.save(plan.rewritten);
    const gone = new Set(plan.seqs);
    this.outbox.splice(0, this.outbox.length, ...this.outbox.filter((record) => !gone.has(record.seq)));
    return plan.blobIds;
  }
}

const HOUR = 60 * 60 * 1000;

describe('AC20: offline, then back online', () => {
  it('keeps every op while offline and sends them in order, check-in first, each once', () => {
    const server = new FakeSiteServer();
    server.online = false;
    const outbox = [
      queued(checkIn('v1')),
      queued(note('n1', 'v1')),
      queued(material('m1', 'v1')),
      queued(note('n2', 'v1')),
      queued(checkOut('o1', 'v1')),
    ];
    const keys = outbox.map((record) => record.op.key);
    const drain = new Drain(outbox, server);

    drain.runUntil(HOUR);
    expect(outbox.map((record) => record.op.key)).toEqual(keys);
    expect(outbox.every((record) => record.state === 'queued')).toBe(true);
    expect(server.rows.size).toBe(0);

    server.online = true;
    drain.runUntil(2 * HOUR);
    expect(outbox).toEqual([]);
    expect(server.requests.map(([key]) => key)).toEqual(keys);
    expect(server.rowsOf('check_in')).toHaveLength(1);
    expect(server.rowsOf('note')).toHaveLength(2);
    expect(server.rowsOf('material')).toHaveLength(1);
    expect(server.rowsOf('check_out')).toHaveLength(1);
  });
});

describe('AC21: a simulated 1102 twice, then success', () => {
  it.each([
    ['the request was killed before it committed', 'cpu_kill_before_commit'],
    ['the row committed and only the answer was lost', 'cpu_kill_after_commit'],
  ] as const)('%s: one row, and waits of 2 s then 4 s (±20 %%)', (_case, fault) => {
    for (const random of [() => 0, () => 0.999999, Math.random]) {
      const server = new FakeSiteServer();
      server.fail('v1', fault, fault);
      const outbox = [queued(checkIn('v1')), queued(note('n1', 'v1'))];
      const drain = new Drain(outbox, server, random);

      drain.runUntil(HOUR);

      expect(outbox).toEqual([]);
      expect(server.rowsOf('check_in')).toHaveLength(1);
      expect(server.rowsOf('note')).toHaveLength(1);
      const tries = server.requests.filter(([key]) => key === 'v1').map(([, at]) => at);
      expect(tries).toHaveLength(3);
      const [first, second, third] = tries;
      expect(second - first).toBeGreaterThanOrEqual(1600);
      expect(second - first).toBeLessThanOrEqual(2400);
      expect(third - second).toBeGreaterThanOrEqual(3200);
      expect(third - second).toBeLessThanOrEqual(4800);
      // The child went only after its check-in was answered, and only once.
      expect(server.requests.filter(([key]) => key === 'n1')).toEqual([['n1', third]]);
    }
  });

  it('a lost answer on a later attempt is answered `already`, never recorded twice', () => {
    const server = new FakeSiteServer();
    server.fail('n1', 'cpu_kill_after_commit', 'network', 'cpu_kill_after_commit');
    const drain = new Drain([queued(checkIn('v1')), queued(note('n1', 'v1'))], server);
    drain.runUntil(HOUR);
    expect(drain.outbox).toEqual([]);
    expect(server.rowsOf('note')).toHaveLength(1);
    expect(server.requests.filter(([key]) => key === 'n1')).toHaveLength(4);
  });
});

describe('AC22: a refusal parks only its op', () => {
  it('a 422 on a note parks that note, and the independent ops still go', () => {
    const server = new FakeSiteServer();
    server.fail('n1', 'refuse_fields');
    const drain = new Drain([queued(checkIn('v1')), queued(note('n1', 'v1')), queued(note('n2', 'v1')), queued(checkOut('o1', 'v1'))], server);

    drain.runUntil(HOUR);

    expect(drain.outbox).toHaveLength(1);
    expect(drain.outbox[0]).toMatchObject({ state: 'needs_attention', op: { key: 'n1' }, lastError: { status: 422, code: 'check_fields' } });
    expect([...server.rows.keys()]).toEqual(['v1', 'n2', 'o1']);
  });

  it('a parked check-in blocks its children until discarded, and discarding removes them and their blobs', () => {
    const server = new FakeSiteServer();
    server.fail('v1', 'refuse_not_assigned');
    const visit = queued(checkIn('v1'));
    const outbox = [
      visit,
      queued(photo('p1', 'v1')),
      queued(note('n1', 'v1')),
      queued(checkIn('v2')),
    ];
    const drain = new Drain(outbox, server);

    drain.runUntil(HOUR);
    expect(outbox.map((record) => [record.op.key, record.state])).toEqual([
      ['v1', 'needs_attention'],
      ['p1', 'queued'],
      ['n1', 'queued'],
    ]);
    expect(server.requests.map(([key]) => key)).toEqual(['v1', 'v2']);

    expect(drain.discard(visit.seq)).toEqual(['p1-display', 'p1-thumb']);
    expect(outbox).toEqual([]);
  });
});

describe('AC23: a 401 pauses the whole queue without losing anything', () => {
  it('stops at the refused op, keeps every record, and resumes from it after sign-in', () => {
    const server = new FakeSiteServer();
    const drain = new Drain([queued(checkIn('v1'))], server);
    drain.runUntil(HOUR);

    server.sessionValid = false;
    drain.outbox.push(queued(note('n1', 'v1')), queued(note('n2', 'v1')), queued(checkOut('o1', 'v1')));
    drain.runUntil(2 * HOUR);

    expect(drain.outbox.map((record) => [record.op.key, record.state])).toEqual([
      ['n1', 'paused_auth'],
      ['n2', 'queued'],
      ['o1', 'queued'],
    ]);
    expect(server.requests.map(([key]) => key)).toEqual(['v1', 'n1']);

    server.sessionValid = true;
    drain.save(resumedAfterSignIn(drain.outbox, ENGINEER, drain.now));
    drain.runUntil(3 * HOUR);

    expect(drain.outbox).toEqual([]);
    expect(server.requests.map(([key]) => key)).toEqual(['v1', 'n1', 'n1', 'n2', 'o1']);
    expect(server.rowsOf('note')).toHaveLength(2);
    expect(server.rowsOf('check_out')).toHaveLength(1);
  });
});

describe('AC22: the engineer clears a parked op by retrying or discarding it', () => {
  // F3 (S1 functional test): a refusal that clears later used to cost the whole visit.
  it('a check-in refused not_assigned goes, with all its children, once he is assigned and retries', () => {
    const server = new FakeSiteServer();
    server.assignedProjects = new Set();
    const visit = queued(checkIn('v1'));
    const drain = new Drain([visit, queued(photo('p1', 'v1')), queued(note('n1', 'v1')), queued(checkOut('o1', 'v1'))], server);

    drain.runUntil(HOUR);
    expect(drain.outbox.map((record) => [record.op.key, record.state])).toEqual([
      ['v1', 'needs_attention'],
      ['p1', 'queued'],
      ['n1', 'queued'],
      ['o1', 'queued'],
    ]);
    expect(nextAttemptDue(drain.outbox, ENGINEER)).toBeNull();

    server.assignedProjects.add('project-1');
    drain.retry(visit.seq);
    drain.runUntil(2 * HOUR);

    expect(drain.outbox).toEqual([]);
    expect([...server.rows.keys()]).toEqual(['v1', 'p1', 'n1', 'o1']);
  });

  // F2 (S1 functional test): discarding a photo used to discard the delivery that cited it.
  it('discarding a refused photo keeps the material that showed it, which then goes without the photo', () => {
    const server = new FakeSiteServer();
    server.fail('p1', 'refuse_photo_too_large');
    const shot = queued(photo('p1', 'v1'));
    const drain = new Drain([queued(checkIn('v1')), shot, queued(material('m1', 'v1', 'p1'))], server);

    drain.runUntil(HOUR);
    expect(drain.outbox.map((record) => [record.op.key, record.state])).toEqual([
      ['p1', 'needs_attention'],
      ['m1', 'queued'],
    ]);

    expect(drain.discard(shot.seq)).toEqual(['p1-display', 'p1-thumb']);
    drain.runUntil(2 * HOUR);

    expect(drain.outbox).toEqual([]);
    expect(server.rows.get('m1')).toEqual(material('m1', 'v1'));
    expect(server.rowsOf('photo')).toEqual([]);
  });

  // F4 (S1 functional test): this answer for a non-photo op used to throw in the runner step.
  it('photo_not_uploaded on a material parks it instead of breaking the drain', () => {
    const server = new FakeSiteServer();
    server.fail('m1', 'photo_not_uploaded');
    const drain = new Drain([queued(checkIn('v1')), queued(material('m1', 'v1')), queued(note('n1', 'v1'))], server);

    drain.runUntil(HOUR);

    expect(drain.outbox).toHaveLength(1);
    expect(drain.outbox[0]).toMatchObject({ state: 'needs_attention', op: { key: 'm1' }, lastError: { status: 409, code: 'photo_not_uploaded' } });
    expect([...server.rows.keys()]).toEqual(['v1', 'n1']);
  });

  // F5 (S1 functional test): a malformed op on a cycle used to stay "queued" for ever.
  it('ops on a dependency cycle are parked as malformed, and the rest of the queue goes', () => {
    const server = new FakeSiteServer();
    const selfVoid = queued(voidOf('x1', { kind: 'note', key: 'x1' }));
    const looped = queued(note('nc', 'vc'));
    const loopBack = queued(voidOf('vc', { kind: 'note', key: 'nc' }));
    const drain = new Drain([selfVoid, looped, loopBack, queued(checkIn('v1')), queued(note('n1', 'v1'))], server);

    drain.runUntil(HOUR);

    expect(drain.outbox.map((record) => [record.op.key, record.state, record.lastError])).toEqual([
      ['x1', 'needs_attention', { status: 0, code: 'malformed' }],
      ['nc', 'needs_attention', { status: 0, code: 'malformed' }],
      ['vc', 'needs_attention', { status: 0, code: 'malformed' }],
    ]);
    expect([...server.rows.keys()]).toEqual(['v1', 'n1']);
  });
});

describe('AC23: a lost session pauses every studio', () => {
  it('a 401 unauthorized in one studio pauses the ops of all of them until the user signs in', () => {
    const server = new FakeSiteServer();
    server.sessionValid = false;
    const drain = new Drain([queued(checkIn('v1'), { orgId: 'org-1' }), queued(checkIn('v2'), { orgId: 'org-2' })], server);

    drain.runUntil(HOUR);
    expect(drain.outbox.map((record) => [record.op.key, record.state])).toEqual([
      ['v1', 'paused_auth'],
      ['v2', 'queued'],
    ]);
    expect(nextAttemptDue(drain.outbox, ENGINEER)).toBeNull();

    server.sessionValid = true;
    drain.save(resumedAfterSignIn(drain.outbox, ENGINEER, drain.now));
    drain.runUntil(2 * HOUR);
    expect(drain.outbox).toEqual([]);
  });
});

describe('AC37: a studio removes this phone', () => {
  // F1 (S1 functional test): device_revoked from one studio used to pause every studio's ops.
  it('parks the ops of that studio with the reason, and the other studio keeps working on the phone', () => {
    const server = new FakeSiteServer();
    server.revokedOrgs.add('org-1');
    const drain = new Drain(
      [
        queued(checkIn('va'), { orgId: 'org-1' }),
        queued(photo('pa', 'va'), { orgId: 'org-1' }),
        queued(note('na', 'va'), { orgId: 'org-1' }),
        queued(checkIn('vb'), { orgId: 'org-2' }),
        queued(note('nb', 'vb'), { orgId: 'org-2' }),
      ],
      server,
    );

    drain.runUntil(HOUR);

    expect([...server.rows.keys()]).toEqual(['vb', 'nb']);
    expect(drain.outbox.map((record) => [record.op.key, record.state, record.attempts, record.lastError])).toEqual([
      ['va', 'needs_attention', 0, { status: 401, code: 'device_revoked' }],
      ['pa', 'needs_attention', 0, { status: 401, code: 'device_revoked' }],
      ['na', 'needs_attention', 0, { status: 401, code: 'device_revoked' }],
    ]);
    // Only the first op of that studio was sent: the rest were parked with it, not tried one by one.
    expect(server.requests.map(([key]) => key)).toEqual(['va', 'vb', 'nb']);
    expect(nextAttemptDue(drain.outbox, ENGINEER)).toBeNull();

    // The studio adds the phone back and the engineer retries: the visit and its children go.
    server.revokedOrgs.delete('org-1');
    for (const record of [...drain.outbox]) drain.retry(record.seq);
    drain.runUntil(2 * HOUR);
    expect(drain.outbox).toEqual([]);
    expect(server.rowsOf('check_in')).toHaveLength(2);
  });

  it('an op made for that studio after the revoke is parked the same way, and the other studio is unaffected', () => {
    const server = new FakeSiteServer();
    server.revokedOrgs.add('org-1');
    const drain = new Drain([queued(checkIn('va'), { orgId: 'org-1' })], server);
    drain.runUntil(HOUR);

    drain.outbox.push(queued(checkIn('va2'), { orgId: 'org-1' }), queued(checkIn('vb'), { orgId: 'org-2' }));
    drain.runUntil(2 * HOUR);

    expect(drain.outbox.map((record) => [record.op.key, record.state])).toEqual([
      ['va', 'needs_attention'],
      ['va2', 'needs_attention'],
    ]);
    expect([...server.rows.keys()]).toEqual(['vb']);
  });
});
