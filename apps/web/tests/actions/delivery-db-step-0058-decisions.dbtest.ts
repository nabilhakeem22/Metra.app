import { afterAll, describe, expect, it } from 'vitest';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, snapshotOf, stampRenders, type RoundBDelivery } from './round-b-fixture';
import { plantEvent, plantTransition, retract } from './round-c-db-fixture';

// Round C, PR-C7: the decisions on file and the expected date that
// app_delivery_by_token now returns (AC 35; fix round F1, F4). Each answers the
// CURRENT round, issuance or stage, never an earlier one.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('decisions on file and the expected date (AC 35)', () => {
  it('design_decision follows the render round', async () => {
    const d = await seedRoundBDelivery(orgIds, 'design-round');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '1 hour'`);
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design' })).toEqual({ ok: true });
    expect((await snapshotOf(d.hash))!.design_decision).toMatchObject({ kind: 'approved' });
    await stampRenders(d.engagementId, 'now()');
    expect((await snapshotOf(d.hash))!.design_decision).toBeNull();
    expect(await recordDeliveryActionByToken(d.token, { action: 'request_design_changes', note: 'Lighter' })).toEqual({ ok: true });
    expect((await snapshotOf(d.hash))!.design_decision).toMatchObject({ kind: 'changes_requested' });
  });

  it('rom_acknowledged_at answers the current issuance only; handover_acknowledged_at after the ack', async () => {
    const d = await seedRoundBDelivery(orgIds, 'acks');
    await raw.query(
      `update public.design_engagements set rom_low = 100000, rom_high = 200000,
              rom_issued_at = now() - interval '1 hour' where id = '${d.engagementId}'`,
    );
    expect(await recordDeliveryActionByToken(d.token, { action: 'acknowledge_rom' })).toEqual({ ok: true });
    expect((await snapshotOf(d.hash))!.rom_acknowledged_at).toEqual(expect.any(String));
    await raw.query(`update public.design_engagements set rom_issued_at = now() where id = '${d.engagementId}'`);
    expect((await snapshotOf(d.hash))!.rom_acknowledged_at).toBeNull();

    await forceState(d.engagementId, 'design_only_handoff');
    expect((await snapshotOf(d.hash))!.handover_acknowledged_at).toBeNull();
    expect(await recordDeliveryActionByToken(d.token, { action: 'acknowledge_handoff' })).toEqual({ ok: true });
    expect((await snapshotOf(d.hash))!.handover_acknowledged_at).toEqual(expect.any(String));
  });

  it('handover_acknowledged_at reflects a staff-recorded acknowledgement too, as the timeline does (F4)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'handover-staff');
    await forceState(d.engagementId, 'design_only_handoff');
    const ack = await plantEvent(d, { kind: 'handoff_acknowledgement', channel: 'staff', evidence: 'Phone call' });
    const snapshot = (await snapshotOf(d.hash))!;
    expect(snapshot.handover_acknowledged_at).toEqual(expect.any(String));
    expect((snapshot.timeline as Array<{ kind?: string }>).map((entry) => entry.kind)).toEqual(['handoff_acknowledgement']);
    // The close target stays the client's own confirmation only.
    const [target] = await raw.query<{ value: unknown }>(
      `select public.app_delivery_close_target_by_token('${d.hash}') as value`,
    );
    expect(target.value).toBeNull();
    await retract(d, ack);
    expect((await snapshotOf(d.hash))!.handover_acknowledged_at).toBeNull();
  });
});

/** Cairo's date `days` from today, as the read function compares it. */
async function cairoDay(days: number): Promise<string> {
  const [row] = await raw.query<{ day: string }>(
    `select ((now() at time zone 'Africa/Cairo')::date + ${days})::text as day`,
  );
  return row.day;
}

async function setExpected(d: RoundBDelivery, day: string, state: string, setAt: string): Promise<void> {
  await raw.query(
    `update public.design_engagements set client_expected_on = '${day}', client_expected_state = '${state}',
            client_expected_set_at = ${setAt} where id = '${d.engagementId}'`,
  );
}

const expectedOn = async (d: RoundBDelivery) => (await snapshotOf(d.hash))!.expected_on;

describe('the expected date (AC 35, fix round F1)', () => {
  it('retires for good on a state move: a revision loop back into the stage does not bring it back', async () => {
    const d = await seedRoundBDelivery(orgIds, 'expected-loop');
    const day = await cairoDay(3);
    await forceState(d.engagementId, 'final_approval');
    await setExpected(d, day, 'final_approval', `now() - interval '1 minute'`);
    expect(await expectedOn(d)).toBe(day);
    // A self-loop is not a state move.
    await plantTransition(d, 'final_approval', 'final_approval', 'now()');
    expect(await expectedOn(d)).toBe(day);

    await plantTransition(d, 'final_approval', 'design_3d', 'now()');
    await forceState(d.engagementId, 'design_3d');
    expect(await expectedOn(d)).toBeNull();
    await plantTransition(d, 'design_3d', 'final_approval', 'now()');
    await forceState(d.engagementId, 'final_approval');
    expect(await expectedOn(d)).toBeNull();

    // Set again in the new round: shown again.
    await setExpected(d, day, 'final_approval', `now() + interval '1 second'`);
    expect(await expectedOn(d)).toBe(day);
  });

  it('shows today and later in Cairo, never a date that has passed', async () => {
    const d = await seedRoundBDelivery(orgIds, 'expected-past');
    await forceState(d.engagementId, 'concept_review');
    for (const [days, shown] of [[0, true], [365, true], [-1, false], [-30, false]] as const) {
      const day = await cairoDay(days);
      await setExpected(d, day, 'concept_review', 'now()');
      expect(await expectedOn(d), `${days} days`).toBe(shown ? day : null);
    }
  });

  it('is null in any other stage', async () => {
    const d = await seedRoundBDelivery(orgIds, 'expected-stage');
    await forceState(d.engagementId, 'concept_review');
    await setExpected(d, await cairoDay(5), 'concept_review', 'now()');
    await forceState(d.engagementId, 'negotiation');
    expect(await expectedOn(d)).toBeNull();
  });
});
