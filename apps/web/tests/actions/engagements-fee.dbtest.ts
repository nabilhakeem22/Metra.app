import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { getEngagementFeeSchedule } from '@/lib/engagements/queries';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

async function milestoneCount(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.engagement_milestones
     where engagement_id = '${engagementId}'`,
  );
  return Number(row.n);
}

/** Seed an org + client + project, and create ONE engagement in `created`. */
async function setup(): Promise<{ ctx: OrgContext; engagementId: string }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
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
  return { ctx, engagementId };
}

function submit(
  ctx: OrgContext,
  engagementId: string,
  payload: GenerateFeeSchedulePayload,
) {
  return executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload,
  });
}

describe('submitDesignFee fee schedule — valid splits commit atomically', () => {
  it('a percent split summing to exactly 100 sets the fee + 4 milestone rows', async () => {
    const { ctx, engagementId } = await setup();
    const res = await submit(ctx, engagementId, {
      designFee: '100000',
      milestones: [
        { kind: 'deposit', basis: 'percent', value: '25' },
        { kind: 'gate_a', basis: 'percent', value: '25' },
        { kind: 'gate_b', basis: 'percent', value: '25' },
        { kind: 'balance', basis: 'percent', value: '25' },
      ],
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(await stateOf(engagementId)).toBe('design_proposal');
    expect(await milestoneCount(engagementId)).toBe(4);

    const schedule = await getEngagementFeeSchedule(ctx, engagementId);
    expect(schedule.designFee).toBe('100000.0000');
    expect(schedule.milestones.map((m) => m.kind)).toEqual([
      'deposit',
      'gate_a',
      'gate_b',
      'balance',
    ]);
    expect(schedule.milestones.every((m) => m.basis === 'percent')).toBe(true);
    expect(schedule.milestones.map((m) => m.value)).toEqual([
      '25.0000',
      '25.0000',
      '25.0000',
      '25.0000',
    ]);
  });

  it('an amount split summing to exactly the fee is accepted', async () => {
    const { ctx, engagementId } = await setup();
    const res = await submit(ctx, engagementId, {
      designFee: '100000',
      milestones: [
        { kind: 'deposit', basis: 'amount', value: '30000' },
        { kind: 'gate_a', basis: 'amount', value: '20000' },
        { kind: 'gate_b', basis: 'amount', value: '20000' },
        { kind: 'balance', basis: 'amount', value: '30000' },
      ],
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(await stateOf(engagementId)).toBe('design_proposal');
    expect(await milestoneCount(engagementId)).toBe(4);

    const schedule = await getEngagementFeeSchedule(ctx, engagementId);
    expect(schedule.designFee).toBe('100000.0000');
    expect(schedule.milestones.every((m) => m.basis === 'amount')).toBe(true);
  });
});

describe('submitDesignFee fee schedule — invalid splits roll back atomically', () => {
  // The core rollback proof: on any coded rejection the engagement must stay in
  // `created` AND leave ZERO milestone rows behind.
  async function expectRejected(
    payload: GenerateFeeSchedulePayload,
    code: string,
  ): Promise<void> {
    const { ctx, engagementId } = await setup();
    const res = await submit(ctx, engagementId, payload);
    expect(res).toEqual({ ok: false, error: code });
    expect(await stateOf(engagementId)).toBe('created');
    expect(await milestoneCount(engagementId)).toBe(0);
  }

  it('a percent split summing 99.9999 is rejected (no rows, state unchanged)', async () => {
    await expectRejected(
      {
        designFee: '100000',
        milestones: [
          { kind: 'deposit', basis: 'percent', value: '25' },
          { kind: 'gate_a', basis: 'percent', value: '25' },
          { kind: 'gate_b', basis: 'percent', value: '25' },
          { kind: 'balance', basis: 'percent', value: '24.9999' },
        ],
      },
      'milestone_split_invalid',
    );
  });

  it('a percent split summing 100.0001 is rejected', async () => {
    await expectRejected(
      {
        designFee: '100000',
        milestones: [
          { kind: 'deposit', basis: 'percent', value: '25' },
          { kind: 'gate_a', basis: 'percent', value: '25' },
          { kind: 'gate_b', basis: 'percent', value: '25' },
          { kind: 'balance', basis: 'percent', value: '25.0001' },
        ],
      },
      'milestone_split_invalid',
    );
  });

  it('an amount split not equal to the fee is rejected', async () => {
    await expectRejected(
      {
        designFee: '100000',
        milestones: [
          { kind: 'deposit', basis: 'amount', value: '30000' },
          { kind: 'balance', basis: 'amount', value: '69999' },
        ],
      },
      'milestone_split_invalid',
    );
  });

  it('a mixed-basis split (percent + amount) is rejected', async () => {
    await expectRejected(
      {
        designFee: '100000',
        milestones: [
          { kind: 'deposit', basis: 'percent', value: '50' },
          { kind: 'balance', basis: 'amount', value: '50000' },
        ],
      },
      'milestone_split_invalid',
    );
  });

  it('a duplicate milestone kind is rejected', async () => {
    await expectRejected(
      {
        designFee: '100000',
        milestones: [
          { kind: 'deposit', basis: 'percent', value: '50' },
          { kind: 'deposit', basis: 'percent', value: '50' },
        ],
      },
      'milestone_kind_duplicate',
    );
  });

  it('a design fee of zero is rejected with design_fee_required', async () => {
    await expectRejected(
      {
        designFee: '0',
        milestones: [{ kind: 'deposit', basis: 'percent', value: '100' }],
      },
      'design_fee_required',
    );
  });

  it('a split with no deposit milestone is rejected', async () => {
    await expectRejected(
      {
        designFee: '100000',
        milestones: [{ kind: 'balance', basis: 'percent', value: '100' }],
      },
      'milestone_split_invalid',
    );
  });
});
