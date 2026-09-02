import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getEngagementClientActivity } from '@/lib/engagements/queries';
import {
  getDeliveryByToken,
  recordDeliveryActionByToken,
} from '@/lib/engagements/public';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Seed an org + client + project + ONE engagement (in `created`), minted link. */
async function seedDelivery(suffix = 'a'): Promise<{
  ctx: OrgContext;
  engagementId: string;
  token: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: `Acme ${suffix}` });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: client.id,
    projectId: project.id,
  });
  const engagementId = (created as { data?: string }).data!;
  const minted = await mintDeliveryLinkCore(ctx, engagementId);
  return { ctx, engagementId, token: minted.data! };
}

/** Force an engagement into a state directly (BYPASSRLS) — mirrors the rom-ack test. */
async function forceState(engagementId: string, state: string): Promise<void> {
  await raw.query(
    `update public.design_engagements set state = '${state}' where id = '${engagementId}'`,
  );
}

/** The CLIENT-CHANNEL event rows for an engagement, over the BYPASSRLS connection. */
async function clientRows(engagementId: string) {
  return raw.query<{
    kind: string;
    actor_channel: string;
    actor_name: string | null;
    actor_ip: string | null;
    actor_user_agent: string | null;
    note: string | null;
    range_low: string | null;
    range_high: string | null;
  }>(
    `select kind, actor_channel, actor_name, actor_ip, actor_user_agent,
            note, range_low, range_high
       from public.engagement_events
      where engagement_id = '${engagementId}' and actor_channel = 'client'
      order by decided_at`,
  );
}

async function totalEventCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_events
      where engagement_id = '${engagementId}'`,
  );
  return Number(row.n);
}

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

describe('app_delivery_respond_by_token — each action at its legal state', () => {
  it('approve_concept at concept_review appends one client concept_approval, ok', async () => {
    const { engagementId, token } = await seedDelivery('approve-concept');
    await forceState(engagementId, 'concept_review');

    const res = await recordDeliveryActionByToken(token, {
      action: 'approve_concept',
      actorName: 'Client Sam',
    });
    expect(res).toEqual({ ok: true });

    const rows = await clientRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('concept_approval');
    expect(rows[0].actor_channel).toBe('client');
    expect(rows[0].actor_name).toBe('Client Sam');
    expect(await totalEventCount(engagementId)).toBe(1);
    // No state move — the signal is advisory only.
    expect(await stateOf(engagementId)).toBe('concept_review');
  });

  it('request_concept_changes at concept_review appends one concept_change_request', async () => {
    const { engagementId, token } = await seedDelivery('req-concept');
    await forceState(engagementId, 'concept_review');

    const res = await recordDeliveryActionByToken(token, {
      action: 'request_concept_changes',
      note: 'please widen the kitchen',
    });
    expect(res).toEqual({ ok: true });

    const rows = await clientRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('concept_change_request');
    expect(rows[0].note).toBe('please widen the kitchen');
    expect(await stateOf(engagementId)).toBe('concept_review');
  });

  it('approve_design at final_approval appends one client design_approval', async () => {
    const { engagementId, token } = await seedDelivery('approve-design');
    await forceState(engagementId, 'final_approval');

    const res = await recordDeliveryActionByToken(token, { action: 'approve_design' });
    expect(res).toEqual({ ok: true });

    const rows = await clientRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('design_approval');
    expect(await stateOf(engagementId)).toBe('final_approval');
  });

  it('request_design_changes at final_approval appends one design_change_request', async () => {
    const { engagementId, token } = await seedDelivery('req-design');
    await forceState(engagementId, 'final_approval');

    const res = await recordDeliveryActionByToken(token, {
      action: 'request_design_changes',
    });
    expect(res).toEqual({ ok: true });

    const rows = await clientRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('design_change_request');
    expect(await stateOf(engagementId)).toBe('final_approval');
  });

  it('acknowledge_rom snapshots the current ROM band into range_low/range_high', async () => {
    const { ctx, engagementId, token } = await seedDelivery('ack-rom');
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1800000',
      romHigh: '2400000',
    });

    const res = await recordDeliveryActionByToken(token, { action: 'acknowledge_rom' });
    expect(res).toEqual({ ok: true });

    const rows = await clientRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('rom_acknowledgement');
    expect(rows[0].range_low).toBe('1800000.0000');
    expect(rows[0].range_high).toBe('2400000.0000');

    // Surfaces in the cockpit client-activity read (gated + newest-first).
    const activity = await getEngagementClientActivity(ctx, engagementId);
    expect(activity).toHaveLength(1);
    expect(activity[0].kind).toBe('rom_acknowledgement');
    expect(activity[0].rangeLow).toBe('1800000.0000');
  });

  it('acknowledge_handoff at design_only_handoff appends one handoff_acknowledgement', async () => {
    const { engagementId, token } = await seedDelivery('ack-handoff');
    await forceState(engagementId, 'design_only_handoff');

    const res = await recordDeliveryActionByToken(token, {
      action: 'acknowledge_handoff',
    });
    expect(res).toEqual({ ok: true });

    const rows = await clientRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('handoff_acknowledgement');
  });
});

describe('app_delivery_respond_by_token — client_actions never leaks a raw state name', () => {
  it('exposes verb tokens only, and drops the group once confirmed', async () => {
    const { engagementId, token } = await seedDelivery('verbs');
    await forceState(engagementId, 'concept_review');

    const [{ data }] = await raw.query<{ data: { client_actions: string[] } }>(
      `select public.app_delivery_by_token(
         (select token_hash from public.design_engagements where id = '${engagementId}')
       ) as data`,
    );
    expect(data.client_actions).toEqual([
      'approve_concept',
      'request_concept_changes',
    ]);
    // Never a raw machine state name.
    const RAW_STATES = ['concept_review', 'final_approval', 'design_only_handoff'];
    for (const stateName of RAW_STATES) {
      expect(data.client_actions).not.toContain(stateName);
    }

    // After the client acts, the mapped surface no longer offers the pair.
    await recordDeliveryActionByToken(token, { action: 'approve_concept' });
    const after = await getDeliveryByToken(token);
    expect(after!.clientActions).not.toContain('approve_concept');
    expect(after!.clientActions).not.toContain('request_concept_changes');
  });
});

describe('app_delivery_respond_by_token — wrong state / expired / terminal / unknown', () => {
  it('wrong-state returns wrong_state and writes nothing', async () => {
    const { engagementId, token } = await seedDelivery('wrong-state');
    await forceState(engagementId, 'final_approval');

    // approve_concept requires concept_review — not final_approval.
    const res = await recordDeliveryActionByToken(token, { action: 'approve_concept' });
    expect(res).toEqual({ ok: false, error: 'wrong_state' });
    expect(await totalEventCount(engagementId)).toBe(0);
  });

  it('acknowledge_rom with no ROM band returns wrong_state, writes nothing', async () => {
    const { engagementId, token } = await seedDelivery('rom-unset');
    const res = await recordDeliveryActionByToken(token, { action: 'acknowledge_rom' });
    expect(res).toEqual({ ok: false, error: 'wrong_state' });
    expect(await totalEventCount(engagementId)).toBe(0);
  });

  it('a terminal delivery returns not_active, writes nothing', async () => {
    const { engagementId, token } = await seedDelivery('terminal');
    await forceState(engagementId, 'abandoned');
    const res = await recordDeliveryActionByToken(token, { action: 'approve_concept' });
    expect(res).toEqual({ ok: false, error: 'not_active' });
    expect(await totalEventCount(engagementId)).toBe(0);
  });

  it('an expired link returns token_expired, writes nothing', async () => {
    const { engagementId, token } = await seedDelivery('expired');
    await forceState(engagementId, 'concept_review');
    await raw.query(
      `update public.design_engagements
         set share_expires_at = now() - interval '1 day'
       where id = '${engagementId}'`,
    );
    const res = await recordDeliveryActionByToken(token, { action: 'approve_concept' });
    expect(res).toEqual({ ok: false, error: 'token_expired' });
    expect(await totalEventCount(engagementId)).toBe(0);
  });

  it('an unknown token hash returns token_invalid', async () => {
    const res = await recordDeliveryActionByToken('never-minted-token', {
      action: 'approve_concept',
    });
    expect(res).toEqual({ ok: false, error: 'token_invalid' });
  });

  it('an unknown action returns token_invalid, writes nothing', async () => {
    const { engagementId, token } = await seedDelivery('unknown-action');
    await forceState(engagementId, 'concept_review');
    const res = await recordDeliveryActionByToken(token, { action: 'demolish' });
    expect(res).toEqual({ ok: false, error: 'token_invalid' });
    expect(await totalEventCount(engagementId)).toBe(0);
  });
});

describe('app_delivery_respond_by_token — idempotency (repeat + concurrent)', () => {
  it('a repeat of the same signal returns already, adds no second row', async () => {
    const { engagementId, token } = await seedDelivery('repeat');
    await forceState(engagementId, 'concept_review');

    expect(await recordDeliveryActionByToken(token, { action: 'approve_concept' })).toEqual({
      ok: true,
    });
    // Second identical submit — idempotent no-op.
    expect(await recordDeliveryActionByToken(token, { action: 'approve_concept' })).toEqual({
      ok: true,
      code: 'already',
    });
    // The paired request_concept_changes is now blocked too (group confirmed).
    expect(
      await recordDeliveryActionByToken(token, { action: 'request_concept_changes' }),
    ).toEqual({ ok: true, code: 'already' });

    expect(await clientRows(engagementId)).toHaveLength(1);
  });

  it('two concurrent identical submits land exactly one row (partial-unique backstop)', async () => {
    const { engagementId, token } = await seedDelivery('concurrent');
    await forceState(engagementId, 'concept_review');

    const [a, b] = await Promise.all([
      recordDeliveryActionByToken(token, { action: 'approve_concept' }),
      recordDeliveryActionByToken(token, { action: 'approve_concept' }),
    ]);
    // Both resolve ok (one records, one maps unique_violation -> already).
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(await clientRows(engagementId)).toHaveLength(1);
  });
});

describe('app_delivery_respond_by_token — cross-delivery isolation', () => {
  it("delivery A's token never writes to delivery B", async () => {
    const a = await seedDelivery('iso-a');
    const b = await seedDelivery('iso-b');
    await forceState(a.engagementId, 'concept_review');
    await forceState(b.engagementId, 'concept_review');

    await recordDeliveryActionByToken(a.token, { action: 'approve_concept' });

    expect(await clientRows(a.engagementId)).toHaveLength(1);
    expect(await clientRows(b.engagementId)).toHaveLength(0);

    // B's token records only against B.
    await recordDeliveryActionByToken(b.token, { action: 'request_concept_changes' });
    const bRows = await clientRows(b.engagementId);
    expect(bRows).toHaveLength(1);
    expect(bRows[0].kind).toBe('concept_change_request');
    expect(await clientRows(a.engagementId)).toHaveLength(1);
  });
});

// A 3-milestone AMOUNT split that OMITS gate_b, so Gate B clears free (no gate_b
// payment needed) — keeps this guard-satisfaction proof focused on the ROM ack.
const WITHOUT_GATE_B: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '50000' },
  ],
};

/** Drive a fresh engagement all the way to `final_approval` (non-Off-Plan). */
async function driveToFinalApproval(): Promise<{
  ctx: OrgContext;
  engagementId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme guard' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: client.id,
    projectId: project.id,
  });
  const engagementId = (created as { data?: string }).data!;
  await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: WITHOUT_GATE_B,
  });
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  await executeTransition(ctx, { engagementId, trigger: 'confirmAndPayDeposit' });
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  await executeTransition(ctx, { engagementId, trigger: 'spatialBaseReady' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  await executeTransition(ctx, { engagementId, trigger: 'optionsReady' });
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  await executeTransition(ctx, { engagementId, trigger: 'selectConcept' });
  await executeTransition(ctx, { engagementId, trigger: 'confirmConcept' });
  await recordArtifactCore(ctx, {
    engagementId,
    kind: 'approved_render',
    contentHash: 'hash-alpha',
  });
  await recordArtifactCore(ctx, {
    engagementId,
    kind: 'approved_render',
    contentHash: 'hash-beta',
  });
  await executeTransition(ctx, { engagementId, trigger: 'rendersReady' });
  expect(await stateOf(engagementId)).toBe('final_approval');
  return { ctx, engagementId };
}

describe('client ROM ack satisfies the existing romAcknowledged guard (no new guard)', () => {
  it('a client rom_acknowledgement lets staff approveDesign advance to shop_drawings', async () => {
    const { ctx, engagementId } = await driveToFinalApproval();
    const minted = await mintDeliveryLinkCore(ctx, engagementId);
    const token = minted.data!;
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '500000',
      romHigh: '800000',
    });

    // The CLIENT acknowledges the ROM via the token path (not the staff core).
    const ack = await recordDeliveryActionByToken(token, { action: 'acknowledge_rom' });
    expect(ack).toEqual({ ok: true });

    // No staff-recorded rom_acknowledgement exists — only the client one.
    const [staffAck] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.engagement_events
        where engagement_id = '${engagementId}'
          and kind = 'rom_acknowledgement' and actor_channel = 'staff'`,
    );
    expect(Number(staffAck.n)).toBe(0);

    // Staff approveDesign advances — the client ack satisfied romAcknowledged, and
    // no NEW blocking guard was introduced (gate_b is free in this schedule).
    const res = await executeTransition(ctx, { engagementId, trigger: 'approveDesign' });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('shop_drawings');
  });

  it('staff recordRomAcknowledgementCore still works alongside the client channel', async () => {
    // seedDelivery already mints the share link, so reuse its token (a second
    // mint would return 'invalid' — the link is already live).
    const { ctx, engagementId, token } = await seedDelivery('staff-ack');
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '100000',
      romHigh: '200000',
    });
    // The staff path is unchanged (backward-compat) — it writes a 'staff' channel row.
    const res = await recordRomAcknowledgementCore(ctx, { engagementId });
    expect(res.ok).toBe(true);
    const [row] = await raw.query<{ actor_channel: string }>(
      `select actor_channel from public.engagement_events
        where engagement_id = '${engagementId}' and kind = 'rom_acknowledgement'`,
    );
    expect(row.actor_channel).toBe('staff');
    // A client ack can still be recorded independently (distinct channel).
    const clientAck = await recordDeliveryActionByToken(token, {
      action: 'acknowledge_rom',
    });
    expect(clientAck).toEqual({ ok: true });
    expect(await clientRows(engagementId)).toHaveLength(1);
  });
});
