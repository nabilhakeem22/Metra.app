// Round B, B8 — "My move" on the deliveries list: the studio's to-do list. Only
// live deliveries whose move is the studio's (or a client payment to confirm)
// come back; one waiting on the client and a closed one do not.
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { claimPaymentByToken } from '@/lib/engagements/public';
import { listEngagements } from '@/lib/engagements/queries';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const SCHEDULE: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '25000' },
    { kind: 'balance', basis: 'amount', value: '25000' },
  ],
};

/** One delivery on its own project, fee schedule submitted, deposit unpaid. */
async function seedDelivery(ctx: OrgContext, clientId: string, code: string): Promise<string> {
  await createProjectCore(ctx, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    code,
    nameEn: `Project ${code}`,
    clientId,
    status: 'active',
  });
  const project = (await listProjects(ctx, {})).find((row) => row.code === code)!;
  const created = await createEngagementCore(ctx, {
    titleEn: `Delivery ${code}`,
    clientId,
    projectId: project.id,
  });
  const engagementId = (created as { data?: string }).data!;
  const submitted = await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: SCHEDULE,
  });
  expect(submitted.ok).toBe(true);
  return engagementId;
}

describe('listEngagements({ move: "mine" })', () => {
  it('returns only the deliveries that are the studio move or a payment to confirm', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
    const [client] = await listClients(ctx, {});
    const tag = orgId.slice(0, 6);

    // Deposit unpaid: the client's move.
    const clientMove = await seedDelivery(ctx, client.id, `WAIT-${tag}`);
    // Deposit paid: the studio's move.
    const studioMove = await seedDelivery(ctx, client.id, `MINE-${tag}`);
    const paid = await recordPaymentCore(ctx, { engagementId: studioMove, kind: 'deposit', amount: '30000' });
    expect(paid.ok).toBe(true);
    // Waiting on the client too, but the client says it paid: the studio confirms.
    const claimed = await seedDelivery(ctx, client.id, `CLAIM-${tag}`);
    const link = await mintDeliveryLinkCore(ctx, claimed);
    expect(await claimPaymentByToken(link.data!, { milestoneKind: 'deposit' })).toEqual({ ok: true });
    // Closed: never on the list, whatever its facts.
    const closed = await seedDelivery(ctx, client.id, `DONE-${tag}`);
    await raw.query(`update public.design_engagements set state = 'execution' where id = '${closed}'`);

    const all = await listEngagements(ctx, {});
    expect(all.rows.map((row) => row.id).sort()).toEqual([clientMove, studioMove, claimed, closed].sort());

    const mine = await listEngagements(ctx, { move: 'mine' });
    expect(mine.rows.map((row) => [row.id, row.whoseMove])).toEqual([
      [claimed, 'confirmPayment'],
      [studioMove, 'studio'],
    ]);
    expect(mine.nextBefore).toBeNull();
    expect(mine.truncated).toBe(false);
  });
});
