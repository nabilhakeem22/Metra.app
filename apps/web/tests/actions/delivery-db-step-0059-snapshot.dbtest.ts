import { afterAll, describe, expect, it } from 'vitest';
import { todayInCairo } from '@/lib/automation/clock';
import { clientExpectedViewOf } from '@/lib/engagements/client-expected-view';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, snapshotOf, stampRenders } from './round-b-fixture';
import { plantPayment, plantTransition } from './round-c-db-fixture';
import { issueBand, literal } from './round-d-db-fixture';

// Round D, PR-D2: the new keys of app_delivery_by_token (AC K1, R1 to R3) and
// the expected date compared at millisecond precision (E1, E2). The F1 loop
// case of 0058 is still pinned in delivery-db-step-0058-decisions.dbtest.ts.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

type Receipt = { kind: string; amount: string; at: string };

describe('K1: the issuance instants', () => {
  it('equal the columns to the microsecond, and are null while nothing is issued', async () => {
    const d = await seedRoundBDelivery(orgIds, 'k1');
    let snapshot = (await snapshotOf(d.hash))!;
    expect([snapshot.rom, snapshot.renders_issued_at]).toEqual([null, null]);
    await raw.query(`update public.design_engagements set rom_low = 1, rom_high = 2 where id = '${d.engagementId}'`);
    expect((await snapshotOf(d.hash))!.rom).toBeNull();

    await issueBand(d.engagementId, 100000, 200000, `timestamptz '2026-10-10 10:00:00.123456+00'`);
    await stampRenders(d.engagementId, `timestamptz '2026-10-09 08:30:00.000007+00'`);
    snapshot = (await snapshotOf(d.hash))!;
    const rom = snapshot.rom as { low: string; high: string; issued_at: string };
    expect(Object.keys(rom).sort()).toEqual(['high', 'issued_at', 'low']);
    const [same] = await raw.query<{ rom: boolean; renders: boolean }>(
      `select ${literal(rom.issued_at)}::timestamptz = rom_issued_at as rom,
              ${literal(snapshot.renders_issued_at as string)}::timestamptz = renders_ready_at as renders
         from public.design_engagements where id = '${d.engagementId}'`,
    );
    expect(same).toEqual({ rom: true, renders: true });
  });
});

describe('R1 to R3: receipts', () => {
  it('R1: every payment, though 60 newer stage moves fill the timeline', async () => {
    const d = await seedRoundBDelivery(orgIds, 'r1');
    for (const [kind, amount] of [['deposit', '30000'], ['gate_a', '20000'], ['gate_b', '25000'], ['balance', '25000']]) {
      await plantPayment(d, kind, amount, `now() - interval '2 days'`);
    }
    for (let move = 0; move < 60; move += 1) {
      const [from, to] = move % 2 === 0 ? ['survey', 'layout'] : ['layout', 'survey'];
      await plantTransition(d, from, to, `now() - interval '1 day' + ${move} * interval '1 minute'`);
    }
    const snapshot = (await snapshotOf(d.hash))!;
    expect(snapshot.receipts as Receipt[]).toHaveLength(4);
    const timeline = snapshot.timeline as Array<{ type: string }>;
    expect(timeline).toHaveLength(60);
    expect(timeline.filter((entry) => entry.type === 'payment')).toHaveLength(0);
  });

  it('R2, R3: newest first, then amount, then id; scale-4 amounts; kind, amount and at only', async () => {
    const d = await seedRoundBDelivery(orgIds, 'r2');
    const same = `timestamptz '2026-10-01 10:00:00+00'`;
    await plantPayment(d, 'deposit', '9', same);
    await plantPayment(d, 'deposit', '100', same);
    await plantPayment(d, 'gate_a', '100', same);
    await plantPayment(d, 'gate_b', '5.5', `timestamptz '2026-10-02 10:00:00+00'`);
    await plantPayment(d, 'balance', '7', `timestamptz '2026-09-30 10:00:00+00'`);
    const receipts = (await snapshotOf(d.hash))!.receipts as Receipt[];
    const tiedIds = await raw.query<{ kind: string }>(
      `select kind from public.payment_events where engagement_id = '${d.engagementId}' and amount = 100 order by id desc`,
    );
    expect(receipts.map((receipt) => [receipt.kind, receipt.amount])).toEqual([
      ['gate_b', '5.5000'],
      [tiedIds[0].kind, '100.0000'],
      [tiedIds[1].kind, '100.0000'],
      ['deposit', '9.0000'],
      ['balance', '7.0000'],
    ]);
    for (const receipt of receipts) expect(Object.keys(receipt).sort()).toEqual(['amount', 'at', 'kind']);
    expect((await snapshotOf((await seedRoundBDelivery(orgIds, 'r2-none')).hash))!.receipts).toEqual([]);
  });
});

/** Set the expected date on `day`, in `state`, at the instant `setAt`. */
async function setExpected(engagementId: string, day: string, state: string, setAt: string): Promise<void> {
  await raw.query(
    `update public.design_engagements set client_expected_on = '${day}', client_expected_state = '${state}',
            client_expected_set_at = timestamptz '${setAt}' where id = '${engagementId}'`,
  );
}

/** What the studio's card says, from the same rows the client page reads. */
async function cardView(engagementId: string, state: 'concept_review', setAt: string, on: string) {
  const transitions = await raw.query<{ fromState: 'concept_review'; toState: 'concept_review'; decidedAt: string }>(
    `select from_state as "fromState", to_state as "toState", to_json(decided_at) #>> '{}' as "decidedAt"
       from public.engagement_transitions where engagement_id = '${engagementId}'`,
  );
  return clientExpectedViewOf({ expected: { on, state, setAt }, state, transitions, today: todayInCairo(new Date()) });
}

describe('E1, E2: the expected date and the card agree to the millisecond', () => {
  const day = '2099-01-01';
  it('E1: moves inside the millisecond the date was set in do not retire it, in SQL or on the card', async () => {
    const d = await seedRoundBDelivery(orgIds, 'e1');
    await forceState(d.engagementId, 'concept_review');
    const setAt = '2026-10-01T10:00:00.000100Z';
    await setExpected(d.engagementId, day, 'concept_review', setAt);
    await plantTransition(d, 'concept_review', 'design_3d', `timestamptz '2026-10-01T10:00:00.000900Z'`);
    await plantTransition(d, 'design_3d', 'concept_review', `timestamptz '2026-10-01T10:00:00.000950Z'`);
    expect((await snapshotOf(d.hash))!.expected_on).toBe(day);
    expect(await cardView(d.engagementId, 'concept_review', setAt, day)).toEqual({ kind: 'showing', on: day });
  });

  it('E2: a move in a later millisecond retires it in both', async () => {
    const d = await seedRoundBDelivery(orgIds, 'e2');
    await forceState(d.engagementId, 'concept_review');
    const setAt = '2026-10-01T10:00:00.000100Z';
    await setExpected(d.engagementId, day, 'concept_review', setAt);
    await plantTransition(d, 'concept_review', 'design_3d', `timestamptz '2026-10-01T10:00:00.001000Z'`);
    await plantTransition(d, 'design_3d', 'concept_review', `timestamptz '2026-10-01T10:00:00.001100Z'`);
    expect((await snapshotOf(d.hash))!.expected_on).toBeNull();
    expect(await cardView(d.engagementId, 'concept_review', setAt, day)).toEqual({ kind: 'moved', on: day });
  });
});
