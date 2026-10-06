// Round A1 — the deliveries list and the dashboard read WHOSE MOVE through one
// batch (constant query count); the cockpit reads it through the single gate
// preview. This pins that the two agree, delivery by delivery, for the same role.
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { getEngagementGatePreview } from '@/lib/engagements/gate-preview';
import {
  getEngagementPaymentClaims,
  listEngagements,
  loadWhoseMovesInTx,
} from '@/lib/engagements/queries';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { claimPaymentByToken } from '@/lib/engagements/public';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import type { DesignState } from '@/lib/engagements/states';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { resolveWhoseMove } from '@/lib/engagements/whose-move';
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

/** One delivery on its own project (a project holds one active delivery). */
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
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'submitDesignFee', payload: SCHEDULE }))
      .ok,
  ).toBe(true);
  return engagementId;
}

async function forceState(engagementId: string, state: DesignState): Promise<void> {
  await raw.query(
    `update public.design_engagements set state = '${state}' where id = '${engagementId}'`,
  );
}

describe('loadWhoseMovesInTx agrees with the cockpit, delivery by delivery', () => {
  it('matches resolveWhoseMove over the single gate preview for every subject', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
    const [client] = await listClients(ctx, {});
    const tag = orgId.slice(0, 6);

    // design_proposal with the deposit unpaid -> waiting on the client.
    const waiting = await seedDelivery(ctx, client.id, `WAIT-${tag}`);
    // The same state with the deposit PAID -> the studio's move. Two live
    // engagements in one batch, differing only in their payments, prove the
    // facts are grouped per engagement and not pooled.
    const paid = await seedDelivery(ctx, client.id, `PAID-${tag}`);
    expect((await recordPaymentCore(ctx, { engagementId: paid, kind: 'deposit', amount: '30000' })).ok).toBe(true);
    // execution_decision with the balance unpaid AND a pending client claim.
    const claimed = await seedDelivery(ctx, client.id, `CLAIM-${tag}`);
    await forceState(claimed, 'execution_decision');
    const minted = await mintDeliveryLinkCore(ctx, claimed);
    await claimPaymentByToken(minted.data!, { milestoneKind: 'balance' });
    // terminal -> closed.
    const closed = await seedDelivery(ctx, client.id, `DONE-${tag}`);
    await forceState(closed, 'execution');

    const subjects = await Promise.all(
      [waiting, paid, claimed, closed].map(async (id) => {
        const [row] = await raw.query<{ state: DesignState }>(
          `select state from public.design_engagements where id = '${id}'`,
        );
        return { id, state: row.state };
      }),
    );

    const batch = await withOrgContext(ctx, (tx) => loadWhoseMovesInTx(tx, ctx.role, subjects));

    for (const subject of subjects) {
      const single = resolveWhoseMove({
        state: subject.state,
        preview: await getEngagementGatePreview(ctx, subject.id),
        pendingClaimCount: (await getEngagementPaymentClaims(ctx, subject.id)).length,
      });
      expect(batch.get(subject.id), subject.state).toBe(single);
    }
    expect(batch.get(waiting)).toBe('client');
    expect(batch.get(paid)).toBe('studio');
    expect(batch.get(claimed)).toBe('confirmPayment');
    expect(batch.get(closed)).toBe('closed');
  });

  it('issues no read for an empty subject list', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const moves = await withOrgContext(ctx, (tx) => loadWhoseMovesInTx(tx, ctx.role, []));
    expect(moves.size).toBe(0);
  });
});

describe('listEngagements pages by keyset, newest first', () => {
  it('pages without repeating or skipping a row, each with its whose-move', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
    const [client] = await listClients(ctx, {});
    const tag = orgId.slice(0, 6);
    const ids = [];
    for (const code of ['A', 'B', 'C']) ids.push(await seedDelivery(ctx, client.id, `${code}-${tag}`));

    const first = await listEngagements(ctx, { size: 2 });
    expect(first.rows.map((row) => row.id)).toEqual([ids[2], ids[1]]);
    expect(first.nextBefore).toBe(first.rows[1].number);
    const second = await listEngagements(ctx, { size: 2, before: first.nextBefore! });
    expect(second.rows.map((row) => row.id)).toEqual([ids[0]]);
    expect(second.nextBefore).toBeNull();
    for (const row of [...first.rows, ...second.rows]) expect(row.whoseMove).toBe('client');
  });
});
