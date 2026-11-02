import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createEngagementCore } from '@/lib/engagements/core';
import { projectDeliveryOffer } from '@/lib/engagements/project-delivery-offer';
import { getDeliveriesByProjects, getEngagementByProject } from '@/lib/engagements/queries/by-project';
import { seedDelivery } from './contract-from-boq-fixture';
import { seedLightHome } from './client-home-fixture';
import { projectRows, seedOtherClient, targetOf } from './design-first-fixture';
import { closeExecutionFixture, seedClientProject } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// One delivery per client per project (OD-1), ACs 5, 6 and 8: a second row would
// be a second link, so it is refused however the first one ended, unless it was
// abandoned; and the panel never lets an abandoned row hide a running one.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const create = (pair: { clientId: string; projectId: string }) => createEngagementCore(owner, { ...pair, titleEn: 'Another' });

describe('createEngagementCore (AC5, AC6)', () => {
  it.each(['execution', 'closed_design_only'])('a row of the pair at %s: project_client_has_delivery, naming it, and no row', async (state) => {
    const pair = await seedClientProject(orgId);
    const existing = await seedDelivery(orgId, pair, state);
    expect(await create(pair)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { projectId: { code: 'project_client_has_delivery', params: { delivery: (await targetOf(existing)).delivery } } },
    });
    expect(await projectRows(pair.projectId)).toHaveLength(1);
  });

  it('a light delivery of the pair refuses too', async () => {
    const { delivery } = await seedLightHome(orgId);
    const pair = { clientId: delivery.clientId, projectId: delivery.projectId };
    expect(await create(pair)).toMatchObject({ fields: { projectId: { code: 'project_client_has_delivery', params: { delivery: (await targetOf(delivery.id)).delivery } } } });
  });

  it('only abandoned rows: created', async () => {
    const pair = await seedClientProject(orgId);
    await seedDelivery(orgId, pair, 'abandoned');
    await seedDelivery(orgId, pair, 'abandoned');
    expect(await create(pair)).toMatchObject({ ok: true });
    expect((await projectRows(pair.projectId)).map((row) => row.state)).toEqual(['abandoned', 'abandoned', 'created']);
  });

  it('an active delivery on the project: project_delivery_exists, for any client', async () => {
    const pair = await seedClientProject(orgId);
    await seedDelivery(orgId, pair, 'layout');
    const expected = { ok: false, error: 'check_fields', fields: { projectId: { code: 'project_delivery_exists' } } };
    expect(await create(pair)).toEqual(expected);
    expect(await create({ clientId: await seedOtherClient(orgId), projectId: pair.projectId })).toEqual(expected);
    expect(await projectRows(pair.projectId)).toHaveLength(1);
  });

  it('a finished delivery of another client leaves room for the project’s new client', async () => {
    const pair = await seedClientProject(orgId);
    await seedDelivery(orgId, pair, 'execution');
    expect(await create({ clientId: await seedOtherClient(orgId), projectId: pair.projectId })).toMatchObject({ ok: true });
  });

  it('a refusal spends no number', async () => {
    const pair = await seedClientProject(orgId);
    const existing = await seedDelivery(orgId, pair, 'execution');
    await create(pair);
    const fresh = await seedClientProject(orgId);
    const created = await create(fresh);
    const [row] = await projectRows(fresh.projectId);
    expect(created).toMatchObject({ ok: true, data: row.id });
    const number = (id: string) => targetOf(id).then((target) => Number(target.delivery.slice(-4)));
    expect(await number(row.id)).toBe((await number(existing)) + 1);
  });
});

describe('which delivery the panel shows (AC8)', () => {
  it('DE-A at execution + DE-B abandoned: DE-A, in both readers', async () => {
    const pair = await seedClientProject(orgId);
    const running = await seedDelivery(orgId, pair, 'execution');
    await seedDelivery(orgId, pair, 'abandoned');
    expect(await getEngagementByProject(owner, pair.projectId)).toMatchObject({ id: running, clientId: pair.clientId });
    expect((await getDeliveriesByProjects(owner, [pair.projectId]))[pair.projectId]).toMatchObject({ id: running });
  });

  it('active first, then the newest non-abandoned, then the newest', async () => {
    const pair = await seedClientProject(orgId);
    const firstAbandoned = await seedDelivery(orgId, pair, 'abandoned');
    const newestAbandoned = await seedDelivery(orgId, pair, 'abandoned');
    const readers = async () => [
      (await getEngagementByProject(owner, pair.projectId))?.id,
      (await getDeliveriesByProjects(owner, [pair.projectId]))[pair.projectId]?.id,
    ];
    expect(firstAbandoned).not.toBe(newestAbandoned);
    expect(await readers()).toEqual([newestAbandoned, newestAbandoned]);
    const closed = await seedDelivery(orgId, pair, 'closed_design_only');
    const executing = await seedDelivery(orgId, pair, 'execution');
    await seedDelivery(orgId, pair, 'abandoned');
    expect(closed).not.toBe(executing);
    expect(await readers()).toEqual([executing, executing]);
    const active = await seedDelivery(orgId, pair, 'boq');
    await seedDelivery(orgId, pair, 'abandoned');
    expect(await readers()).toEqual([active, active]);
  });

  it("F3: a former client's newer finished row never hides the project client's own, and adds no statement", async () => {
    for (const state of ['execution', 'closed_design_only']) {
      const pair = await seedClientProject(orgId);
      const own = await seedDelivery(orgId, pair, state);
      await seedDelivery(orgId, { clientId: await seedOtherClient(orgId), projectId: pair.projectId }, state);
      const shown = await getEngagementByProject(owner, pair.projectId);
      expect(shown).toMatchObject({ id: own, clientId: pair.clientId });
      expect(shown).not.toHaveProperty('projectClientId');
      expect(projectDeliveryOffer(shown, pair.clientId).create).toBeNull();
      const batched = (await getDeliveriesByProjects(owner, [pair.projectId]))[pair.projectId];
      expect(batched).toEqual(shown);
    }
  });

  it("F3: only a former client's finished row: shown, and Start is what the core allows", async () => {
    const pair = await seedClientProject(orgId);
    const former = await seedDelivery(orgId, { clientId: await seedOtherClient(orgId), projectId: pair.projectId }, 'execution');
    const shown = await getEngagementByProject(owner, pair.projectId);
    expect(shown?.id).toBe(former);
    expect(projectDeliveryOffer(shown, pair.clientId).create).toBe('start');
    expect(await create(pair)).toMatchObject({ ok: true });
  });

  it('a project with no delivery reads null, and the batch keeps it', async () => {
    const pair = await seedClientProject(orgId);
    expect(await getEngagementByProject(owner, pair.projectId)).toBeNull();
    expect(await getDeliveriesByProjects(owner, [pair.projectId])).toEqual({ [pair.projectId]: null });
  });
});
