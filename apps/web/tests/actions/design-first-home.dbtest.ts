import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureClientHomeCore } from '@/lib/client-home/ensure';
import type { OrgContext } from '@/lib/db/context';
import { createEngagementCore } from '@/lib/engagements/core';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { hashShareToken } from '@/lib/share/token';
import { seedDelivery } from './contract-from-boq-fixture';
import { projectRows, targetOf } from './design-first-fixture';
import { seedBillableContract } from './execution-billing-fixture';
import { closeExecutionFixture, seedClientProject, seedExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// The same link (ACs 9 to 11): the home is the pair's one delivery, and the Client
// page control answers the link the client already holds. A light delivery is
// born only when the pair has none, and a create racing it never makes a second.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let previousSecret: string | undefined;

beforeAll(async () => {
  previousSecret = process.env.SHARE_LINK_SECRET;
  process.env.SHARE_LINK_SECRET = 'df-share-link-secret-0123456789abcdef0123456789';
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
});

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.SHARE_LINK_SECRET;
  else process.env.SHARE_LINK_SECRET = previousSecret;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

describe('the home of a contract (AC9, AC10)', () => {
  it('answers the raw token minted at first share, and token_hash does not change', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'execution');
    const first = (await mintDeliveryLinkCore(owner, id)).data!;
    const [before] = await projectRows(pair.projectId);
    expect(before.token_hash).toBe(hashShareToken(first));
    const contract = await seedBillableContract(orgId, 'issued', { id, ...pair });
    expect(await ensureClientHomeCore(owner, { contractId: contract.contractId })).toMatchObject({
      ok: true,
      data: { engagementId: id, link: first },
    });
    expect((await projectRows(pair.projectId)).map((row) => row.token_hash)).toEqual([before.token_hash]);
  });

  it('with an open design: design_open, and no row and no token written', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'execution_decision');
    const contract = await seedBillableContract(orgId, 'issued', { id, ...pair });
    expect(await ensureClientHomeCore(owner, { contractId: contract.contractId })).toEqual({
      ok: false,
      error: 'design_open',
      params: await targetOf(id),
    });
    expect(await projectRows(pair.projectId)).toEqual([expect.objectContaining({ id, token_hash: null })]);
  });

  it('a null-engagement BOQ beside an open design: design_open, naming it, and no light delivery', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'boq');
    const contract = await seedExecutionContract(orgId, { state: 'issued', project: pair });
    expect(await ensureClientHomeCore(owner, { contractId: contract.contractId })).toEqual({ ok: false, error: 'design_open', params: await targetOf(id) });
    expect(await projectRows(pair.projectId)).toHaveLength(1);
  });

  it('a null-engagement BOQ on a pair with a design delivery at execution: client_home_unavailable, row count unchanged', async () => {
    const pair = await seedClientProject(orgId);
    await seedDelivery(orgId, pair, 'execution');
    const contract = await seedExecutionContract(orgId, { state: 'issued', project: pair });
    expect(await ensureClientHomeCore(owner, { contractId: contract.contractId })).toEqual({ ok: false, error: 'client_home_unavailable' });
    expect(await projectRows(pair.projectId)).toHaveLength(1);
  });

  it('an abandoned delivery behind the BOQ, no other: client_home_unavailable, and no light delivery beside it', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'abandoned');
    const contract = await seedExecutionContract(orgId, { state: 'issued', delivery: { id, ...pair } });
    expect(await ensureClientHomeCore(owner, { contractId: contract.contractId })).toEqual({ ok: false, error: 'client_home_unavailable' });
    expect(await projectRows(pair.projectId)).toHaveLength(1);
  });
});

describe('the light delivery (AC11)', () => {
  it('a null-engagement BOQ with no delivery: one light delivery, and two concurrent calls still make one', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    const answers = await Promise.all([
      ensureClientHomeCore(owner, { contractId: contract.contractId }),
      ensureClientHomeCore(owner, { contractId: contract.contractId }),
    ]);
    const rows = await projectRows(contract.projectId);
    expect(rows).toEqual([expect.objectContaining({ state: 'execution', entry_phase: 'execution' })]);
    const ok = answers.filter((answer) => answer.ok);
    expect(ok.length).toBeGreaterThan(0);
    for (const answer of ok) expect(answer.data?.engagementId).toBe(rows[0].id);
  });

  it('a create racing a light insert, 20 rounds: exactly one row each round', async () => {
    const seen = new Set<string>();
    for (let round = 0; round < 20; round += 1) {
      const contract = await seedExecutionContract(orgId, { state: 'issued' });
      const pair = { clientId: contract.clientId, projectId: contract.projectId };
      const [home, created] = await Promise.all([
        ensureClientHomeCore(owner, { contractId: contract.contractId }),
        createEngagementCore(owner, { ...pair, titleEn: 'Racing' }),
      ]);
      const rows = await projectRows(pair.projectId);
      expect(rows, `round ${String(round)}`).toHaveLength(1);
      const light = rows[0].entry_phase === 'execution';
      seen.add(light ? 'light' : 'design');
      if (light) {
        expect(home).toMatchObject({ ok: true, data: { engagementId: rows[0].id } });
        expect(created).toMatchObject({ fields: { projectId: { code: 'project_client_has_delivery' } } });
      } else {
        expect(created).toMatchObject({ ok: true, data: rows[0].id });
        expect(home).toEqual({ ok: false, error: 'design_open', params: await targetOf(rows[0].id) });
      }
    }
    console.info(`create vs light insert winners over 20 rounds: ${[...seen].join(', ')}`);
  });
});
