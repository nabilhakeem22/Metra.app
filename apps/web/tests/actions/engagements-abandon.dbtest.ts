import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { TRANSITIONS } from '@/lib/engagements/transitions';
import type { DesignState } from '@/lib/engagements/states';
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

/** Force an engagement into a state directly (BYPASSRLS) — the rom-ack pattern. */
async function forceState(engagementId: string, state: string): Promise<void> {
  await raw.query(
    `update public.design_engagements set state = '${state}' where id = '${engagementId}'`,
  );
}

async function abandonTransitions(engagementId: string) {
  return raw.query<{ from_state: string; to_state: string }>(
    `select from_state, to_state from public.engagement_transitions
      where engagement_id = '${engagementId}' and trigger = 'abandon'
      order by decided_at`,
  );
}

/** Seed an org + client + project and create ONE engagement (in `created`). */
async function setup(): Promise<{ ctx: OrgContext; engagementId: string }> {
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
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: client.id,
    projectId: project.id,
  });
  return { ctx, engagementId: (created as { data?: string }).data! };
}

describe('abandon — the guard-less off-ramp (tail wiring)', () => {
  it('fires from EVERY declared from-state, writing one ledger row per fire', async () => {
    const { ctx, engagementId } = await setup();
    const declaredFrom = TRANSITIONS.abandon.from as DesignState[];

    // One engagement, re-armed per state (BYPASSRLS force — the machine walk is
    // proven elsewhere; this test is about the from-set), abandoned from each.
    for (const from of declaredFrom) {
      await forceState(engagementId, from);
      const res = await executeTransition(ctx, { engagementId, trigger: 'abandon' });
      expect(res.ok, `abandon must fire from ${from}`).toBe(true);
      expect(await stateOf(engagementId)).toBe('abandoned');
    }

    const ledger = await abandonTransitions(engagementId);
    expect(ledger).toHaveLength(declaredFrom.length);
    expect(ledger.map((row) => row.from_state).sort()).toEqual(
      [...declaredFrom].sort(),
    );
    for (const row of ledger) expect(row.to_state).toBe('abandoned');
  });

  it('never fires from a terminal state (illegal_trigger, no ledger row)', async () => {
    const { ctx, engagementId } = await setup();

    for (const terminal of ['execution', 'closed_design_only', 'abandoned']) {
      await forceState(engagementId, terminal);
      const res = await executeTransition(ctx, { engagementId, trigger: 'abandon' });
      expect(res, `abandon must be illegal from ${terminal}`).toEqual({
        ok: false,
        error: 'illegal_trigger',
      });
      expect(await stateOf(engagementId)).toBe(terminal);
    }
    expect(await abandonTransitions(engagementId)).toHaveLength(0);
  });

  it('post-abandon writes are rejected (engagement_not_active)', async () => {
    const { ctx, engagementId } = await setup();
    const res = await executeTransition(ctx, { engagementId, trigger: 'abandon' });
    expect(res.ok).toBe(true);
    expect(await stateOf(engagementId)).toBe('abandoned');

    expect(
      await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '1' }),
    ).toEqual({ ok: false, error: 'engagement_not_active' });
    expect(
      await recordArtifactCore(ctx, { engagementId, kind: 'survey' }),
    ).toEqual({ ok: false, error: 'engagement_not_active' });
  });
});
