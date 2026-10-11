import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, stampRenders } from './round-b-fixture';
import {
  clientEventCount,
  issuancesOf,
  issueBand,
  literal,
  newestClientEvent,
  respondSeen,
} from './round-d-db-fixture';

// Round D, PR-D2: the consent guard (AC G1 to G7). The seven-argument
// app_delivery_respond_by_token saves a budget acknowledgement only for the
// band issuance the client saw, and a design decision only for the render
// round the client saw; anything else answers wrong_state and writes nothing.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('acknowledge_rom names the band issuance it answers', () => {
  it('G1: the current instant is saved, with the band it dates', async () => {
    const d = await seedRoundBDelivery(orgIds, 'g1');
    await issueBand(d.engagementId, 100000, 200000, `now() - interval '1 hour'`);
    const { rom } = await issuancesOf(d.hash);
    expect(await respondSeen(d.hash, 'acknowledge_rom', rom)).toBe('ok');
    expect(await newestClientEvent(d.engagementId, 'rom_acknowledgement')).toMatchObject({
      issue_matches_rom: true, range_low: '100000.0000', range_high: '200000.0000',
    });
  });

  it('G2: a band re-issued since the page loaded is refused, and nothing is written', async () => {
    const d = await seedRoundBDelivery(orgIds, 'g2');
    await issueBand(d.engagementId, 100000, 200000, `now() - interval '1 hour'`);
    const seen = (await issuancesOf(d.hash)).rom;
    await issueBand(d.engagementId, 150000, 250000);
    expect(await respondSeen(d.hash, 'acknowledge_rom', seen)).toBe('wrong_state');
    expect(await clientEventCount(d.engagementId)).toBe(0);
  });

  it('G3: no instant while a band is issued is refused', async () => {
    const d = await seedRoundBDelivery(orgIds, 'g3');
    await issueBand(d.engagementId, 100000, 200000);
    expect(await respondSeen(d.hash, 'acknowledge_rom', null)).toBe('wrong_state');
    expect(await clientEventCount(d.engagementId)).toBe(0);
  });
});

describe('the design verbs name the render round they answer', () => {
  for (const action of ['approve_design', 'request_design_changes']) {
    it(`G4: ${action} is saved for the current round and refused for the previous one`, async () => {
      const d = await seedRoundBDelivery(orgIds, `g4-${action}`);
      await forceState(d.engagementId, 'final_approval');
      await stampRenders(d.engagementId, `now() - interval '2 hours'`);
      const previous = (await issuancesOf(d.hash)).renders;
      await stampRenders(d.engagementId, `now() - interval '1 hour'`);
      expect(await respondSeen(d.hash, action, previous)).toBe('wrong_state');
      expect(await clientEventCount(d.engagementId)).toBe(0);
      const current = (await issuancesOf(d.hash)).renders;
      expect(await respondSeen(d.hash, action, current)).toBe('ok');
      const kind = action === 'approve_design' ? 'design_approval' : 'design_change_request';
      expect(await newestClientEvent(d.engagementId, kind)).toMatchObject({ issue_matches_renders: true });
    });
  }

  it('G5: a legacy delivery with no render stamp takes no instant', async () => {
    const d = await seedRoundBDelivery(orgIds, 'g5');
    await forceState(d.engagementId, 'final_approval');
    expect((await issuancesOf(d.hash)).renders).toBeNull();
    expect(await respondSeen(d.hash, 'approve_design', '2026-10-10T10:00:00Z')).toBe('wrong_state');
    expect(await respondSeen(d.hash, 'approve_design', null)).toBe('ok');
  });
});

describe('repeats and precision', () => {
  it('G6: a repeat with the same instant is already; after a re-issue, the old instant is wrong_state', async () => {
    const d = await seedRoundBDelivery(orgIds, 'g6');
    await forceState(d.engagementId, 'final_approval');
    await stampRenders(d.engagementId, `now() - interval '1 hour'`);
    await issueBand(d.engagementId, 100000, 200000, `now() - interval '1 hour'`);
    const seen = await issuancesOf(d.hash);
    expect(await respondSeen(d.hash, 'approve_design', seen.renders)).toBe('ok');
    expect(await respondSeen(d.hash, 'acknowledge_rom', seen.rom)).toBe('ok');
    expect(await respondSeen(d.hash, 'approve_design', seen.renders)).toBe('already');
    expect(await respondSeen(d.hash, 'acknowledge_rom', seen.rom)).toBe('already');
    await stampRenders(d.engagementId, 'now()');
    await issueBand(d.engagementId, 100000, 200000);
    expect(await respondSeen(d.hash, 'approve_design', seen.renders)).toBe('wrong_state');
    expect(await respondSeen(d.hash, 'acknowledge_rom', seen.rom)).toBe('wrong_state');
    expect(await clientEventCount(d.engagementId)).toBe(2);
  });

  it('G7: the snapshot string round-trips to the microsecond; one microsecond more is refused', async () => {
    const d = await seedRoundBDelivery(orgIds, 'g7');
    await issueBand(d.engagementId, 100000, 200000, `timestamptz '2026-10-10 10:00:00.123456+00'`);
    const { rom } = await issuancesOf(d.hash);
    expect(rom).toMatch(/\.123456/);
    const [later] = await raw.query<{ at: string }>(
      `select (${literal(rom)}::timestamptz + interval '1 microsecond')::text as at`,
    );
    expect(await respondSeen(d.hash, 'acknowledge_rom', later.at)).toBe('wrong_state');
    expect(await respondSeen(d.hash, 'acknowledge_rom', rom)).toBe('ok');
  });

  it('caps the caller name, address and user agent like the concept choice (120 / 45 / 512)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'caps');
    await forceState(d.engagementId, 'design_only_handoff');
    await raw.query(
      `select public.app_delivery_respond_by_token('${d.hash}', 'acknowledge_handoff', null, null,
         repeat('n', 200), repeat('i', 100), repeat('u', 1000))`,
    );
    const event = await newestClientEvent(d.engagementId, 'handoff_acknowledgement');
    expect([event.actor_name?.length, event.actor_ip?.length, event.actor_user_agent?.length]).toEqual([120, 45, 512]);
  });
});
