import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface Ledger {
  from_state: string | null;
  to_state: string | null;
  trigger: string | null;
  actor_user_id: string | null;
}

async function ledgerFor(engagementId: string): Promise<Ledger[]> {
  return raw.query<Ledger>(
    `select from_state, to_state, trigger, actor_user_id
     from public.engagement_transitions
     where engagement_id = '${engagementId}' order by decided_at`,
  );
}

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

/** Seed an org + client + project, and create ONE engagement in `created`. */
async function setup(): Promise<{
  orgId: string;
  ctx: OrgContext;
  userId: string;
  engagementId: string;
}> {
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
  return { orgId, ctx, userId: ownerIds[0], engagementId };
}

describe('executeTransition — submitDesignFee (Design-Engagement Machine, Step 2)', () => {
  it('moves created -> design_proposal and writes exactly one ledger row', async () => {
    const { ctx, userId, engagementId } = await setup();
    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'submitDesignFee',
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(await stateOf(engagementId)).toBe('design_proposal');

    const ledger = await ledgerFor(engagementId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      from_state: 'created',
      to_state: 'design_proposal',
      trigger: 'submitDesignFee',
      actor_user_id: userId,
    });
  });

  it('from a non-`created` state -> illegal_trigger, no state change, no extra ledger row', async () => {
    const { ctx, engagementId } = await setup();
    // First move lands it in design_proposal.
    await executeTransition(ctx, { engagementId, trigger: 'submitDesignFee' });
    // Second submit is illegal from design_proposal.
    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'submitDesignFee',
    });
    expect(res).toEqual({ ok: false, error: 'illegal_trigger' });
    expect(await stateOf(engagementId)).toBe('design_proposal');
    expect(await ledgerFor(engagementId)).toHaveLength(1);
  });

  it('a declared-but-unwired trigger -> transition_not_yet_enabled, state + ledger untouched', async () => {
    const { ctx, engagementId } = await setup();
    // Reach confirmAndPayDeposit's `from` state (design_proposal) so the flow
    // gets past the from-check and actually runs its (pending) guard.
    await executeTransition(ctx, { engagementId, trigger: 'submitDesignFee' });
    const res = await executeTransition(ctx, {
      engagementId,
      trigger: 'confirmAndPayDeposit',
    });
    expect(res).toEqual({ ok: false, error: 'transition_not_yet_enabled' });
    // Guard failure rolls back: no state move, no second ledger row.
    expect(await stateOf(engagementId)).toBe('design_proposal');
    expect(await ledgerFor(engagementId)).toHaveLength(1);
  });

  it('two concurrent submitDesignFee: exactly one wins, one ledger row (atomic gate)', async () => {
    const { ctx, engagementId } = await setup();
    const [a, b] = await Promise.all([
      executeTransition(ctx, { engagementId, trigger: 'submitDesignFee' }),
      executeTransition(ctx, { engagementId, trigger: 'submitDesignFee' }),
    ]);

    const results = [a, b];
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);

    // The safety invariant: the atomic gate admits EXACTLY ONE writer.
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    // The loser is rejected either at the atomic gate (it read `created` before
    // the winner committed, then the UPDATE ... WHERE state='created' matched 0
    // rows -> engagement_state_conflict) OR at the from-check (its SELECT landed
    // after the winner committed, reading `design_proposal`, from which
    // submitDesignFee is illegal -> illegal_trigger). Under READ COMMITTED the
    // interleaving decides which; both prove no double-transition occurred.
    expect(['engagement_state_conflict', 'illegal_trigger']).toContain(
      losers[0].error,
    );

    // Regardless of the loser's code: one move, one ledger row.
    expect(await stateOf(engagementId)).toBe('design_proposal');
    const ledger = await ledgerFor(engagementId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      from_state: 'created',
      to_state: 'design_proposal',
    });
  });

  it('a foreign-org engagementId -> engagement_not_found (RLS hides the row)', async () => {
    const a = await setup();
    const b = await setup();
    const res = await executeTransition(a.ctx, {
      engagementId: b.engagementId,
      trigger: 'submitDesignFee',
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });
    // Org B's engagement is untouched.
    expect(await stateOf(b.engagementId)).toBe('created');
    expect(await ledgerFor(b.engagementId)).toHaveLength(0);
  });
});
