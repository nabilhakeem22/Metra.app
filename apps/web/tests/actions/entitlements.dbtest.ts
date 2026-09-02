// Flow-gate proof (Epic A2). mutateInOrg refuses a flow-gated core with
// `flow_not_enabled` when the workspace's entitlements don't include the flow,
// and lets it proceed when they do. Covers ALL SIX flow-gated interior entry
// points: createEngagementCore + executeTransition (create/advance) and the four
// data-entry cores (recordPayment, setEngagementRom, recordArtifact,
// recordRomAcknowledgement). Reads stay open (unaffected — no flow opt on them).
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// A valid fee-schedule payload — submitDesignFee (created -> design_proposal)
// requires one. We only need it accepted; the split math is tested elsewhere.
const VALID_FEE = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'percent', value: '50' },
    { kind: 'balance', basis: 'percent', value: '50' },
  ],
} as const;

async function setEnabledFlows(orgId: string, flows: string): Promise<void> {
  // BYPASSRLS raw update of the seeded entitlement row — never an UPDATE under
  // metra_app (that path is forbidden by the bootstrap RLS ordering rule).
  await raw.query(
    `update public.workspace_entitlements set enabled_flows = '${flows}' where org_id = '${orgId}'`,
  );
}

/** Seed an org (fixture seeds `{interior}`) with one client + project. */
async function setup(): Promise<{
  orgId: string;
  ctx: OrgContext;
  clientId: string;
  projectId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  return { orgId, ctx, clientId: client.id, projectId: project.id };
}

describe('flow gate — createEngagementCore', () => {
  it('refuses with flow_not_enabled when interior is not enabled', async () => {
    const { orgId, ctx, clientId, projectId } = await setup();
    await setEnabledFlows(orgId, '{}');

    const res = await createEngagementCore(ctx, {
      titleEn: 'Villa fit-out',
      clientId,
      projectId,
    });
    expect(res).toEqual({ ok: false, error: 'flow_not_enabled' });

    // No engagement row was written (the gate fires before the core body).
    const [count] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.design_engagements where org_id = '${orgId}'`,
    );
    expect(Number(count.n)).toBe(0);
  });

  it('proceeds when interior is enabled', async () => {
    const { orgId, ctx, clientId, projectId } = await setup();
    await setEnabledFlows(orgId, '{interior}');

    const res = await createEngagementCore(ctx, {
      titleEn: 'Villa fit-out',
      clientId,
      projectId,
    });
    expect(res.ok).toBe(true);
  });
});

describe('flow gate — executeTransition', () => {
  it('refuses with flow_not_enabled when interior is not enabled', async () => {
    const { orgId, ctx, clientId, projectId } = await setup();
    // Create the engagement WHILE interior is enabled, then disable the flow.
    const created = await createEngagementCore(ctx, {
      titleEn: 'Villa fit-out',
      clientId,
      projectId,
    });
    const engagementId = (created as { data?: string }).data!;
    await setEnabledFlows(orgId, '{}');

    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'submitDesignFee',
      payload: VALID_FEE,
    });
    expect(res).toEqual({ ok: false, error: 'flow_not_enabled' });

    // The gate fired before the transition: state and ledger are untouched.
    const [row] = await raw.query<{ state: string }>(
      `select state from public.design_engagements where id = '${engagementId}'`,
    );
    expect(row.state).toBe('created');
    const [ledger] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.engagement_transitions where engagement_id = '${engagementId}'`,
    );
    expect(Number(ledger.n)).toBe(0);
  });

  it('proceeds when interior is enabled', async () => {
    const { ctx, clientId, projectId } = await setup();
    const created = await createEngagementCore(ctx, {
      titleEn: 'Villa fit-out',
      clientId,
      projectId,
    });
    const engagementId = (created as { data?: string }).data!;

    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'submitDesignFee',
      payload: VALID_FEE,
    });
    expect(res).toEqual({ ok: true, data: undefined });
    const [row] = await raw.query<{ state: string }>(
      `select state from public.design_engagements where id = '${engagementId}'`,
    );
    expect(row.state).toBe('design_proposal');
  });
});

describe('flow gate — data-entry cores (all refused when interior absent)', () => {
  it('recordPayment / setEngagementRom / recordArtifact / recordRomAcknowledgement all return flow_not_enabled', async () => {
    const { orgId, ctx, clientId, projectId } = await setup();
    // Create the engagement WHILE interior is enabled, then disable the flow so
    // every data-entry core is gated. The capability check (owner passes) runs
    // first, then the flow gate fires INSIDE mutateInOrg before each core body —
    // so no engagement state/precondition is exercised on the refuse path.
    const created = await createEngagementCore(ctx, {
      titleEn: 'Villa fit-out',
      clientId,
      projectId,
    });
    const engagementId = (created as { data?: string }).data!;
    await setEnabledFlows(orgId, '{}');

    expect(
      await recordPaymentCore(ctx, {
        engagementId,
        kind: 'deposit',
        amount: '30000',
      }),
    ).toEqual({ ok: false, error: 'flow_not_enabled' });

    expect(
      await setEngagementRomCore(ctx, {
        engagementId,
        romLow: '1800000',
        romHigh: '2400000',
      }),
    ).toEqual({ ok: false, error: 'flow_not_enabled' });

    expect(
      await recordArtifactCore(ctx, { engagementId, kind: 'survey' }),
    ).toEqual({ ok: false, error: 'flow_not_enabled' });

    expect(
      await recordRomAcknowledgementCore(ctx, { engagementId }),
    ).toEqual({ ok: false, error: 'flow_not_enabled' });

    // The gate fired before any core body wrote: no payment / artifact / event
    // rows, and ROM was never set on the engagement.
    const [counts] = await raw.query<{
      payments: number;
      artifacts: number;
      events: number;
    }>(
      `select
         (select count(*)::int from public.payment_events where engagement_id = '${engagementId}') as payments,
         (select count(*)::int from public.engagement_artifacts where engagement_id = '${engagementId}') as artifacts,
         (select count(*)::int from public.engagement_events where engagement_id = '${engagementId}') as events`,
    );
    expect(Number(counts.payments)).toBe(0);
    expect(Number(counts.artifacts)).toBe(0);
    expect(Number(counts.events)).toBe(0);
  });
});
