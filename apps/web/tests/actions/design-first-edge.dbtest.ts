import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readHomeView } from '@/app/[locale]/d/[token]/home-read';
import { loadEngagementDetail } from '@/app/[locale]/(app)/engagements/[id]/engagement-detail-data';
import type { OrgContext } from '@/lib/db/context';
import { executeTransition } from '@/lib/engagements/executor';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { DESIGN_STATES } from '@/lib/engagements/states';
import type { GenerateFeeSchedulePayload } from '@/lib/engagements/transitions';
import { seedBoq, seedDelivery } from './contract-from-boq-fixture';
import { projectRows } from './design-first-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// continueToExecution (ACs 15 and 17): a design-only delivery whose client later
// decides to build goes on to execution on the SAME row, so the same link.

const orgIds: string[] = [];
let orgId: string;
let contexts: Record<'owner' | 'admin' | 'project_manager' | 'accountant' | 'site_engineer' | 'viewer', OrgContext>;
let previousSecret: string | undefined;

const WITH_BALANCE: GenerateFeeSchedulePayload = {
  designFee: '100000',
  milestones: [
    { kind: 'deposit', basis: 'amount', value: '30000' },
    { kind: 'gate_a', basis: 'amount', value: '20000' },
    { kind: 'gate_b', basis: 'amount', value: '20000' },
    { kind: 'balance', basis: 'amount', value: '30000' },
  ],
};

beforeAll(async () => {
  previousSecret = process.env.SHARE_LINK_SECRET;
  process.env.SHARE_LINK_SECRET = 'df-share-link-secret-0123456789abcdef0123456789';
  const seeded = await seedOrg({
    owners: 1,
    members: [{ role: 'admin' }, { role: 'project_manager' }, { role: 'accountant' }, { role: 'site_engineer' }, { role: 'viewer' }],
  });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  const [admin, manager, accountant, engineer, viewer] = seeded.memberIds;
  contexts = {
    owner: ctxFor(orgId, seeded.ownerIds[0], 'owner'),
    admin: ctxFor(orgId, admin, 'admin'),
    project_manager: ctxFor(orgId, manager, 'project_manager'),
    accountant: ctxFor(orgId, accountant, 'accountant'),
    site_engineer: ctxFor(orgId, engineer, 'site_engineer'),
    viewer: ctxFor(orgId, viewer, 'viewer'),
  };
});

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.SHARE_LINK_SECRET;
  else process.env.SHARE_LINK_SECRET = previousSecret;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const fire = (ctx: OrgContext, engagementId: string) => executeTransition(ctx, { engagementId, trigger: 'continueToExecution' });

async function closedDelivery() {
  const pair = await seedClientProject(orgId);
  return { pair, id: await seedDelivery(orgId, pair, 'closed_design_only') };
}

describe('the edge (AC15)', () => {
  it.each(DESIGN_STATES.filter((state) => state !== 'closed_design_only'))('from %s: illegal_trigger', async (state) => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, state);
    expect(await fire(contexts.owner, id)).toEqual({ ok: false, error: 'illegal_trigger' });
    expect((await projectRows(pair.projectId))[0].state).toBe(state);
  });

  it.each(['owner', 'admin', 'project_manager'] as const)('%s may fire it, and it writes the ledger row', async (role) => {
    const { pair, id } = await closedDelivery();
    expect(await fire(contexts[role], id)).toMatchObject({ ok: true });
    expect((await projectRows(pair.projectId))[0].state).toBe('execution');
    const ledger = await ownerQuery<{ trigger: string; from_state: string; to_state: string }>(
      `select trigger, from_state::text as from_state, to_state::text as to_state from public.engagement_transitions where engagement_id = $1`,
      [id],
    );
    expect(ledger).toEqual([{ trigger: 'continueToExecution', from_state: 'closed_design_only', to_state: 'execution' }]);
  });

  it.each(['accountant', 'site_engineer', 'viewer'] as const)('%s may not', async (role) => {
    const { pair, id } = await closedDelivery();
    expect(await fire(contexts[role], id)).toMatchObject({ ok: false, error: 'forbidden' });
    expect((await projectRows(pair.projectId))[0].state).toBe('closed_design_only');
  });

  it('a second fire is illegal_trigger', async () => {
    const { id } = await closedDelivery();
    expect(await fire(contexts.owner, id)).toMatchObject({ ok: true });
    expect(await fire(contexts.owner, id)).toEqual({ ok: false, error: 'illegal_trigger' });
  });

  it('an unmet balance refuses, and leaves the row closed', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'created');
    const fee = await executeTransition(contexts.owner, { engagementId: id, trigger: 'submitDesignFee', payload: WITH_BALANCE });
    expect(fee).toMatchObject({ ok: true });
    await tamper(`update public.design_engagements set state = 'closed_design_only' where id = $1`, [id]);
    expect(await fire(contexts.owner, id)).toEqual({ ok: false, error: 'balance_not_cleared' });
    expect((await projectRows(pair.projectId))[0].state).toBe('closed_design_only');
  });
});

describe('after continuing (AC17)', () => {
  it('the same token opens Execution with no tab, the design tab stays read-only, and the BOQ is the next action', async () => {
    const { pair, id } = await closedDelivery();
    const link = (await mintDeliveryLinkCore(contexts.owner, id)).data!;
    const boq = await seedBoq(orgId, { project: pair, engagementId: id });
    const [before] = await projectRows(pair.projectId);
    expect((await readHomeView(link, null)).tab).toBe('design');

    expect(await fire(contexts.owner, id)).toMatchObject({ ok: true });

    const [after] = await projectRows(pair.projectId);
    expect(after).toMatchObject({ id, token_hash: before.token_hash, state: 'execution' });
    expect((await readHomeView(link, null)).tab).toBe('execution');
    const design = await readHomeView(link, 'design');
    expect(design.tab).toBe('design');
    if (design.tab !== 'design' || design.read.status !== 'ok') throw new Error('no design view');
    expect(design.read.delivery.stageKey).toBe('construction');

    const detail = await loadEngagementDetail(contexts.owner, id);
    expect(detail?.header.state).toBe('execution');
    expect(detail?.execution).toMatchObject({ boqId: boq.boqId, contract: null });
  });
});
