import { createSql } from '@metra/db';
import { afterAll, describe, expect, it } from 'vitest';
import { approveDesignWithBudgetAndNotify } from '@/lib/engagements/client-acts/design-acts';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, stampRenders } from './round-b-fixture';
import { consentCounts, issueBand, pageSeenWithBand } from './round-d-db-fixture';
import { holdDeliveryRow, prepareWrite, TIMED_WRITES, timedOutcome, type TimedWrite } from './round-e-db-fixture';

// Round E (0060), AC T1 to T4: the four delivery token writes that wait on the
// delivery row wait at most 4 s. A studio transaction holding that row makes
// the write fail with 55P03 and roll back whole (nothing lands); the caller's
// own lock_timeout is untouched; once the row is free the same call saves. The
// portal's one-tap approve and budget answers the generic failure well inside
// the app's 15 s deadline, and nothing commits after that answer (D3 R2).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const WRITES = Object.keys(TIMED_WRITES) as TimedWrite[];

describe('T1: each timed write keeps its signature and grants, and carries lock_timeout 4s', () => {
  for (const write of WRITES) {
    it(write, async () => {
      const signature = TIMED_WRITES[write];
      const [row] = await raw.query<{ definer: boolean; config: string[]; metra_app: boolean; public_grants: number }>(
        `select p.prosecdef as definer, p.proconfig as config,
                has_function_privilege('metra_app', p.oid, 'execute') as metra_app,
                (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0) as public_grants
           from pg_proc p where p.oid = '${signature}'::regprocedure`,
      );
      expect({ ...row, config: [...row.config].sort() }).toEqual({
        definer: true,
        config: ['lock_timeout=4s', 'search_path=""'],
        metra_app: true,
        public_grants: 0,
      });
      const roles = await raw.query<{ rolname: string; allowed: boolean }>(
        `select rolname, has_function_privilege(rolname, '${signature}', 'execute') as allowed
           from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`,
      );
      expect(roles.filter((role) => role.allowed)).toEqual([]);
    });
  }
});

describe('T2, T3: a held delivery row fails the write in about 4 s, and nothing lands', () => {
  for (const write of WRITES) {
    it(write, async () => {
      const prepared = await prepareWrite(orgIds, write, 't2');
      const before = await prepared.rows();
      const caller = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
      try {
        // The caller would wait for ever on its own: only the function's 4 s can fire.
        await caller.unsafe(`set lock_timeout = 0`);
        const [{ lock_timeout: callerTimeout }] = await caller.unsafe<Array<{ lock_timeout: string }>>('show lock_timeout');
        const held = await holdDeliveryRow(prepared.delivery.engagementId);
        const blocked = await timedOutcome(() => caller.unsafe(prepared.callSql));
        await held.release();
        expect(blocked.outcome).toBe('55P03');
        expect(blocked.ms).toBeGreaterThanOrEqual(3900);
        expect(blocked.ms).toBeLessThanOrEqual(6000);
        expect(await prepared.rows()).toBe(before);
        const [{ lock_timeout: after }] = await caller.unsafe<Array<{ lock_timeout: string }>>('show lock_timeout');
        expect(after).toBe(callerTimeout);
        expect(after).toBe('0');

        const free = await timedOutcome(() => caller.unsafe(prepared.callSql));
        expect(free.outcome).toBe('ok');
        expect(await prepared.rows()).toBe(before + 1);
      } finally {
        await caller.end();
      }
    }, 30_000);
  }
});

describe('T4: the one-tap approve and budget behind a held row (D3 R2 closed)', () => {
  it('answers uncertain (the lock wait may still commit) in under 6 s, and nothing commits after the answer', async () => {
    const d = await seedRoundBDelivery(orgIds, 't4');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '2 hours'`);
    await issueBand(d.engagementId, 900000, 1200000, `now() - interval '1 hour'`);
    const seen = await pageSeenWithBand(d.token);
    const held = await holdDeliveryRow(d.engagementId);
    const started = performance.now();
    const answer = await approveDesignWithBudgetAndNotify(d.token, { note: 'Lovely' }, seen);
    const ms = performance.now() - started;
    await held.release({ commit: true });
    // 55P03 is ambiguous by contract (db-failure.ts): the client is told to
    // refresh and check, never "a problem on our side, try again".
    expect(answer).toEqual({ kind: 'error', error: 'uncertain' });
    expect(ms).toBeLessThan(6000);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const counts = await consentCounts(d.engagementId);
    expect([counts.designApprovals, counts.romAcknowledgements]).toEqual([0, 0]);
  }, 30_000);
});
