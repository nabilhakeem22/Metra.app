// Round A1 — the fee form opens on the org's LAST written split. Pins which
// schedule counts as "last" and that another org's schedule never leaks in.
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { getLastUsedFeeSchedule } from '@/lib/engagements/queries';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function orgWithClient(): Promise<{ ctx: OrgContext; clientId: string }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  return { ctx, clientId: client.id };
}

async function deliveryWithSchedule(
  ctx: OrgContext,
  clientId: string,
  code: string,
  schedule: GenerateFeeSchedulePayload,
): Promise<void> {
  await createProjectCore(ctx, { startDate: '2026-01-01', code, nameEn: code, clientId });
  const project = (await listProjects(ctx, {})).find((row) => row.code === code)!;
  const created = await createEngagementCore(ctx, { clientId, projectId: project.id });
  const engagementId = (created as { data?: string }).data!;
  expect(
    (await executeTransition(ctx, { engagementId, trigger: 'submitDesignFee', payload: schedule }))
      .ok,
  ).toBe(true);
}

describe('getLastUsedFeeSchedule', () => {
  it('is null for an org that never wrote a schedule', async () => {
    const { ctx } = await orgWithClient();
    expect(await getLastUsedFeeSchedule(ctx)).toBeNull();
  });

  it('returns the most recently written schedule, with its fee, and never another org\'s', async () => {
    const a = await orgWithClient();
    await deliveryWithSchedule(a.ctx, a.clientId, 'FIRST', {
      designFee: '100000',
      milestones: [
        { kind: 'deposit', basis: 'percent', value: '50' },
        { kind: 'balance', basis: 'percent', value: '50' },
      ],
    });
    await deliveryWithSchedule(a.ctx, a.clientId, 'SECOND', {
      designFee: '90000',
      milestones: [
        { kind: 'deposit', basis: 'amount', value: '45000' },
        { kind: 'gate_b', basis: 'amount', value: '45000' },
      ],
    });

    const last = await getLastUsedFeeSchedule(a.ctx);
    expect(last?.designFee).toBe('90000.0000');
    expect(last?.milestones.map((row) => [row.kind, row.basis]).sort()).toEqual([
      ['deposit', 'amount'],
      ['gate_b', 'amount'],
    ]);

    const b = await orgWithClient();
    expect(await getLastUsedFeeSchedule(b.ctx)).toBeNull();
  });
});
