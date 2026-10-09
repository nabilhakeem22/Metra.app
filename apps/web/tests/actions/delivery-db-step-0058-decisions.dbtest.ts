import { afterAll, describe, expect, it } from 'vitest';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, snapshotOf, stampRenders } from './round-b-fixture';

// Round C, PR-C7: the decisions on file and the expected date that
// app_delivery_by_token now returns (AC 35). Each answers the CURRENT round,
// issuance or stage, never an earlier one.

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

  it('expected_on shows only while the delivery is in the stage it was set for', async () => {
    const d = await seedRoundBDelivery(orgIds, 'expected');
    await forceState(d.engagementId, 'concept_review');
    await raw.query(
      `update public.design_engagements set client_expected_on = '2026-12-01',
              client_expected_state = 'concept_review' where id = '${d.engagementId}'`,
    );
    expect((await snapshotOf(d.hash))!.expected_on).toBe('2026-12-01');
    await forceState(d.engagementId, 'negotiation');
    expect((await snapshotOf(d.hash))!.expected_on).toBeNull();
  });
});
