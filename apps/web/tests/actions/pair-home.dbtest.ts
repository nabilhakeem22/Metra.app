import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionError } from '@/lib/actions/result';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { readExecutionGate, readPairDeliveries, requireDesignFinished } from '@/lib/engagements/pair-home';
import { seedDelivery } from './contract-from-boq-fixture';
import { seedOtherClient, targetOf } from './design-first-fixture';
import { closeExecutionFixture, seedClientProject } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// The design-first rule's read: the pair's deliveries, abandoned ones and other
// clients' ignored, and another org's invisible (RLS).

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let otherOwner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  const other = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId, other.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  otherOwner = ctxFor(other.orgId, other.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

describe('readPairDeliveries', () => {
  it('ignores abandoned rows and the deliveries of another client on the project', async () => {
    const pair = await seedClientProject(orgId);
    await seedDelivery(orgId, pair, 'abandoned');
    const otherClient = await seedOtherClient(orgId);
    await seedDelivery(orgId, { clientId: otherClient, projectId: pair.projectId }, 'execution');
    const own = await seedDelivery(orgId, pair, 'execution');
    const rows = await withOrgContext(owner, (tx) => readPairDeliveries(tx, pair));
    expect(rows.map((row) => row.id)).toEqual([own]);
    expect(rows[0]).toMatchObject({ state: 'execution', entryPhase: 'design', number: expect.any(Number) });
  });

  it('another org reads the pair as empty', async () => {
    const pair = await seedClientProject(orgId);
    await seedDelivery(orgId, pair, 'boq');
    expect(await withOrgContext(otherOwner, (tx) => readPairDeliveries(tx, pair))).toEqual([]);
    expect(await withOrgContext(otherOwner, (tx) => readExecutionGate(tx, pair))).toEqual({ kind: 'no_delivery' });
  });
});

describe('requireDesignFinished', () => {
  const refusalOf = async (pair: { clientId: string; projectId: string }) => {
    try {
      await withOrgContext(owner, (tx) => requireDesignFinished(tx, pair));
      return null;
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
      return { code: error.code, params: error.detail?.params };
    }
  };

  it('refuses while design runs, and when it stands closed, naming the delivery', async () => {
    const open = await seedClientProject(orgId);
    const openId = await seedDelivery(orgId, open, 'design_only_handoff');
    expect(await refusalOf(open)).toEqual({ code: 'design_open', params: await targetOf(openId) });
    const closed = await seedClientProject(orgId);
    const closedId = await seedDelivery(orgId, closed, 'closed_design_only');
    expect(await refusalOf(closed)).toEqual({ code: 'design_only_closed', params: await targetOf(closedId) });
  });

  it('answers the gate at a home, and with no delivery', async () => {
    const pair = await seedClientProject(orgId);
    expect(await withOrgContext(owner, (tx) => requireDesignFinished(tx, pair))).toEqual({ kind: 'no_delivery' });
    const id = await seedDelivery(orgId, pair, 'execution');
    expect(await withOrgContext(owner, (tx) => requireDesignFinished(tx, pair))).toMatchObject({ kind: 'home', delivery: { id } });
  });
});
