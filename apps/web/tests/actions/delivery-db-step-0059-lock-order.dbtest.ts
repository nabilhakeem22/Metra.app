import { createSql } from '@metra/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, stampRenders, type RoundBDelivery } from './round-b-fixture';
import { notificationsOf, plantEvent, sweepAs, sweepRoles } from './round-c-db-fixture';
import { issueBand } from './round-d-db-fixture';

// Round D, PR-D2 fix round (reliability R1): the hourly sweep notifies
// client_budget_acknowledged BEFORE the design keys, the order the portal's
// one-tap approve and budget uses. The notifier locks per (recipient, key), so
// with one order on both sides a sweep and a repeat tap that repairs BOTH acts
// in ONE transaction never deadlock (in the other order most such races
// ended in 40P01).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const LOST = `now() - interval '30 minutes'`;
const TRIALS = 12;

function notifySql(d: RoundBDelivery, bodyKey: string): string {
  return `select public.app_delivery_notify_studio_by_token('${d.hash}', '${bodyKey}', '{}'::jsonb,
            '${JSON.stringify(sweepRoles()[bodyKey])}'::jsonb)`;
}

describe('the sweep and a two-act repair take the per-recipient locks in one order (R1)', () => {
  it(`${TRIALS} races of the sweep against two taps that repair budget then design in one transaction: no deadlock`, async () => {
    const d = await seedRoundBDelivery(orgIds, 'lock-order', [{ role: 'admin' }, { role: 'project_manager' }]);
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '2 hours'`);
    await issueBand(d.engagementId, 100000, 200000, `now() - interval '2 hours'`);
    await plantEvent(d, { kind: 'rom_acknowledgement', at: LOST, issueAt: `(select rom_issued_at from public.design_engagements where id = '${d.engagementId}')` });
    await plantEvent(d, { kind: 'design_approval', at: LOST, issueAt: `(select renders_ready_at from public.design_engagements where id = '${d.engagementId}')` });
    const taps = [1, 2].map(() => createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false }));
    const tap = (connection: (typeof taps)[number]) =>
      connection.begin(async (tx) => {
        await tx.unsafe(notifySql(d, 'client_budget_acknowledged'));
        await new Promise((resolve) => setTimeout(resolve, 2));
        await tx.unsafe(notifySql(d, 'client_design_approved'));
      });
    const failures: string[] = [];
    try {
      for (let trial = 0; trial < TRIALS; trial += 1) {
        await raw.query(`delete from public.notifications where entity_id = '${d.engagementId}'`);
        const settled = await Promise.allSettled([sweepAs(d.ctx), tap(taps[0]), tap(taps[1])]);
        for (const outcome of settled) {
          if (outcome.status === 'rejected') failures.push(sqlstateOf(outcome.reason) ?? String(outcome.reason));
        }
        const counts = (await notificationsOf(d.engagementId)).map((row) => [row.body_key, row.count]);
        expect(new Set(counts.map(([key]) => key))).toEqual(new Set(['client_budget_acknowledged', 'client_design_approved']));
        expect(counts.every(([, count]) => count === 1), JSON.stringify(counts)).toBe(true);
      }
    } finally {
      await Promise.all(taps.map((connection) => connection.end()));
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
