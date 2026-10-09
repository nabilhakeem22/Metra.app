import { afterAll, describe, expect, it } from 'vitest';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { hashShareToken } from '@/lib/share/token';
import { closeFixture, raw, teardown } from './fixture';
import { seedRoundBDelivery, type RoundBDelivery } from './round-b-fixture';
import { plantClaim, plantEvent, sweepAs, sweepRoles } from './round-c-db-fixture';

// Round C, PR-C7: the sweep is BOUNDED (AC 40): at most 50 notifier calls per
// call; what is left waits for the next one and is then repaired, once. An act
// nobody would hear about spends none of the 50 (fix round F7).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const LOST = `now() - interval '30 minutes'`;

/** Another delivery, with its own live link, in the SAME org as `first`. */
async function anotherDelivery(first: RoundBDelivery, index: number): Promise<RoundBDelivery> {
  const [client] = await listClients(first.ctx, {});
  const code = `CAP-${index}-${first.orgId.slice(0, 6)}`;
  expect((await createProjectCore(first.ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30', code, nameEn: `Tower ${index}`, clientId: client.id, status: 'active',
  })).ok).toBe(true);
  const project = (await listProjects(first.ctx, {})).find((row) => row.code === code)!;
  const created = await createEngagementCore(first.ctx, {
    titleEn: `Villa ${index}`, titleAr: 'فيلا', clientId: client.id, projectId: project.id,
  });
  const engagementId = (created as { data?: string }).data!;
  const token = (await mintDeliveryLinkCore(first.ctx, engagementId)).data!;
  return { ...first, engagementId, token, hash: hashShareToken(token) };
}

/** Ten lost acts on one delivery: six decisions and four milestone claims. */
async function tenLostActs(d: RoundBDelivery): Promise<void> {
  for (const kind of [
    'concept_approval', 'concept_change_request', 'design_approval', 'design_change_request',
    'rom_acknowledgement', 'handoff_acknowledgement',
  ]) {
    await plantEvent(d, { kind, at: LOST });
  }
  for (const milestone of ['deposit', 'gate_a', 'gate_b', 'balance']) await plantClaim(d, milestone, LOST);
}

describe('app_notify_lost_client_acts: the bound (AC 40)', () => {
  it('60 lost acts: 50 notifier calls, then the other 10, then nothing', async () => {
    const first = await seedRoundBDelivery(orgIds, 'sweep-cap');
    const deliveries = [first];
    for (let index = 1; index < 6; index += 1) deliveries.push(await anotherDelivery(first, index));
    for (const d of deliveries) await tenLostActs(d);

    const notificationCount = async () =>
      Number((await raw.query<{ n: number }>(
        `select count(*)::int as n from public.notifications where org_id = '${first.orgId}'`,
      ))[0].n);

    const firstCall = await sweepAs(first.ctx);
    expect(firstCall).toHaveLength(50);
    expect(await notificationCount()).toBe(50);
    const secondCall = await sweepAs(first.ctx);
    expect(secondCall).toHaveLength(10);
    expect(await notificationCount()).toBe(60);
    expect(await sweepAs(first.ctx)).toEqual([]);

    // Every (delivery, key, milestone) was repaired exactly once across the two calls.
    const keys = [...firstCall!, ...secondCall!].map(
      (entry) => `${entry.notified?.engagement_id}:${entry.body_key}:${entry.milestone_kind}`,
    );
    expect(new Set(keys).size).toBe(60);
  });

  it('acts whose role map reaches nobody cost nothing and cannot starve the bound (F7)', async () => {
    const first = await seedRoundBDelivery(orgIds, 'sweep-unheard');
    const deliveries = [first];
    for (let index = 1; index < 6; index += 1) deliveries.push(await anotherDelivery(first, index));
    for (const d of deliveries) await tenLostActs(d);
    // Every key but the handover maps to a role nobody in this org holds, to
    // the client role only, to a malformed value, or is missing from the map.
    const roles = {
      ...Object.fromEntries(Object.entries(sweepRoles()).map(([key]) => [key, ['viewer']])),
      client_concept_approved: ['client'],
      client_design_approved: 'owner',
      client_handover_acknowledged: ['owner'],
    } as Record<string, unknown>;
    delete roles.client_payment_claimed;
    const entries = await sweepAs(first.ctx, undefined, undefined, roles);
    expect(entries!.map((entry) => entry.body_key)).toEqual(Array(6).fill('client_handover_acknowledged'));
    expect(entries!.every((entry) => entry.notified?.notified_count === 1)).toBe(true);
    expect(await sweepAs(first.ctx, undefined, undefined, roles)).toEqual([]);
  });
});
