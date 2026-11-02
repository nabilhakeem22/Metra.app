import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueBoqCore } from '@/lib/boqs/issue';
import { generateContractCore, generateExecutionContractCore, issueContractCore, recordContractSignedOfflineCore } from '@/lib/contracts/core';
import type { OrgContext } from '@/lib/db/context';
import { ACTIVE_STATES } from '@/lib/engagements/states';
import { createProposalCore, saveProposalDraftCore } from '@/lib/proposals/core';
import { sendProposalCore } from '@/lib/proposals/lifecycle';
import { respondToProposalByToken } from '@/lib/proposals/public';
import { seedBoq, seedDelivery } from './contract-from-boq-fixture';
import { CHARGES, contractCount, seedOtherClient, targetOf } from './design-first-fixture';
import { seedBillableContract } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject, type DeliveryRef } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// Design first (owner ruling, Nov 2 2026), ACs 1 to 4, 12 and 14: every core that
// could start execution refuses beside an open design, and writes nothing.

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

const generate = (boqId: string) => generateExecutionContractCore(owner, { boqId, ...CHARGES });

async function nextContractNumber(): Promise<number> {
  const [row] = await ownerQuery<{ next: number }>(`select coalesce(max(number), 0) + 1 as next from public.contracts where org_id = $1`, [orgId]);
  return row.next;
}

describe('generate (AC1 to AC3)', () => {
  it.each([...ACTIVE_STATES])('at %s: design_open, no contract and no number', async (state) => {
    const pair = await seedClientProject(orgId);
    const deliveryId = await seedDelivery(orgId, pair, state);
    const boq = await seedBoq(orgId, { project: pair, engagementId: deliveryId });
    const before = await nextContractNumber();
    expect(await generate(boq.boqId)).toEqual({ ok: false, error: 'design_open', params: await targetOf(deliveryId) });
    expect(await contractCount(pair.projectId)).toBe(0);
    expect(await nextContractNumber()).toBe(before);
  });

  it('the BOQ of an execution delivery beside an open one: design_open naming the OPEN one', async () => {
    const pair = await seedClientProject(orgId);
    const executing = await seedDelivery(orgId, pair, 'execution');
    const open = await seedDelivery(orgId, pair, 'execution_decision');
    const boq = await seedBoq(orgId, { project: pair, engagementId: executing });
    expect(await generate(boq.boqId)).toEqual({ ok: false, error: 'design_open', params: await targetOf(open) });
    expect(await contractCount(pair.projectId)).toBe(0);
  });

  it('at closed_design_only: design_only_closed', async () => {
    const pair = await seedClientProject(orgId);
    const closed = await seedDelivery(orgId, pair, 'closed_design_only');
    const boq = await seedBoq(orgId, { project: pair, engagementId: closed });
    expect(await generate(boq.boqId)).toEqual({ ok: false, error: 'design_only_closed', params: await targetOf(closed) });
  });

  it("an abandoned delivery's BOQ: boq_not_on_home, with no other delivery or beside a current one at execution", async () => {
    const pair = await seedClientProject(orgId);
    const abandoned = await seedDelivery(orgId, pair, 'abandoned');
    const boq = await seedBoq(orgId, { project: pair, engagementId: abandoned });
    expect(await generate(boq.boqId)).toEqual({ ok: false, error: 'boq_not_on_home' });
    await seedDelivery(orgId, pair, 'execution');
    expect(await generate(boq.boqId)).toEqual({ ok: false, error: 'boq_not_on_home' });
    expect(await contractCount(pair.projectId)).toBe(0);
  });

  it('a null-engagement BOQ beside a design delivery at execution: boq_not_on_home; beside a light one, or none: allowed', async () => {
    const pair = await seedClientProject(orgId);
    await seedDelivery(orgId, pair, 'execution');
    const refused = await seedBoq(orgId, { project: pair, deliveryState: null });
    expect(await generate(refused.boqId)).toEqual({ ok: false, error: 'boq_not_on_home' });
    const standalone = await seedBoq(orgId, { deliveryState: null });
    expect(await generate(standalone.boqId)).toMatchObject({ ok: true });
  });

  it("another client's open design on the project does not stop this client's home", async () => {
    const pair = await seedClientProject(orgId);
    const home = await seedDelivery(orgId, pair, 'execution');
    const boq = await seedBoq(orgId, { project: pair, engagementId: home });
    await seedDelivery(orgId, { clientId: await seedOtherClient(orgId), projectId: pair.projectId }, 'boq');
    expect(await generate(boq.boqId)).toMatchObject({ ok: true });
  });
});

describe('issue and paper signature (AC4)', () => {
  async function contractBesideOpenDesign(state: 'draft' | 'issued') {
    const pair = await seedClientProject(orgId);
    const deliveryId = await seedDelivery(orgId, pair, 'execution_decision');
    const delivery: DeliveryRef = { id: deliveryId, ...pair };
    const contract = await seedBillableContract(orgId, state, delivery);
    return { contractId: contract.contractId, target: await targetOf(deliveryId) };
  }

  const stateOf = async (contractId: string) => {
    const [row] = await ownerQuery<{ status: string; token_hash: string | null; events: number }>(
      `select status::text as status, token_hash,
              (select count(*)::int from public.contract_events e where e.contract_id = c.id) as events
         from public.contracts c where c.id = $1`,
      [contractId],
    );
    return row;
  };

  it('issue answers design_open: a draft stays a draft, no token, no event', async () => {
    const { contractId, target } = await contractBesideOpenDesign('draft');
    const before = await stateOf(contractId);
    expect(await issueContractCore(owner, { id: contractId })).toEqual({ ok: false, error: 'design_open', params: target });
    expect(await stateOf(contractId)).toEqual(before);
    expect(before).toMatchObject({ status: 'draft', token_hash: null });
  });

  it('a paper signature answers design_open: status, token and events unchanged', async () => {
    const { contractId, target } = await contractBesideOpenDesign('issued');
    const before = await stateOf(contractId);
    const today = new Date().toISOString().slice(0, 10);
    expect(await recordContractSignedOfflineCore(owner, { contractId, signedOn: today, note: '' })).toEqual({ ok: false, error: 'design_open', params: target });
    expect(await stateOf(contractId)).toEqual(before);
    expect(before.status).toBe('issued');
  });
});

describe('a proposal contract (AC12)', () => {
  async function acceptedProposal(pair: { clientId: string; projectId: string }): Promise<string> {
    const id = ((await createProposalCore(owner, pair)) as { data?: string }).data!;
    await saveProposalDraftCore(owner, {
      id,
      sections: [
        {
          titleEn: 'Civil',
          lines: [{ descriptionEn: 'Wall', qty: '1', unit: 'lump_sum', unitCost: '600', unitPrice: '1000', discountPct: '0', sortOrder: 0 }],
        },
      ],
    });
    const token = (await sendProposalCore(owner, { id })).data!;
    await respondToProposalByToken(token, { decision: 'accept' });
    return id;
  }

  it('with a delivery: contract_from_boq_only naming it', async () => {
    const pair = await seedClientProject(orgId);
    const proposalId = await acceptedProposal(pair);
    const home = await seedDelivery(orgId, pair, 'execution');
    expect(await generateContractCore(owner, { proposalId })).toEqual({ ok: false, error: 'contract_from_boq_only', params: await targetOf(home) });
    expect(await contractCount(pair.projectId)).toBe(0);
  });

  it('with design open: design_open; closed: design_only_closed', async () => {
    const open = await seedClientProject(orgId);
    const openProposal = await acceptedProposal(open);
    const openId = await seedDelivery(orgId, open, 'layout');
    expect(await generateContractCore(owner, { proposalId: openProposal })).toEqual({ ok: false, error: 'design_open', params: await targetOf(openId) });
    const closed = await seedClientProject(orgId);
    const closedProposal = await acceptedProposal(closed);
    const closedId = await seedDelivery(orgId, closed, 'closed_design_only');
    expect(await generateContractCore(owner, { proposalId: closedProposal })).toEqual({ ok: false, error: 'design_only_closed', params: await targetOf(closedId) });
  });

  it('with no delivery, or only an abandoned one: created as today', async () => {
    const pair = await seedClientProject(orgId);
    expect(await generateContractCore(owner, { proposalId: await acceptedProposal(pair) })).toMatchObject({ ok: true });
    const abandoned = await seedClientProject(orgId);
    await seedDelivery(orgId, abandoned, 'abandoned');
    expect(await generateContractCore(owner, { proposalId: await acceptedProposal(abandoned) })).toMatchObject({ ok: true });
  });
});

describe('issuing a BOQ with no single delivery (AC14)', () => {
  it('boq_needs_delivery, before any render', async () => {
    const boq = await seedBoq(orgId, { state: 'draft', deliveryState: null });
    expect(await issueBoqCore(owner, { boqId: boq.boqId, locale: 'en' })).toEqual({ ok: false, error: 'boq_needs_delivery' });
  });

  it('with two non-abandoned deliveries on the project: the same answer', async () => {
    const pair = await seedClientProject(orgId);
    await seedDelivery(orgId, pair, 'execution');
    await seedDelivery(orgId, { clientId: await seedOtherClient(orgId), projectId: pair.projectId }, 'execution');
    const boq = await seedBoq(orgId, { project: pair, state: 'draft', deliveryState: null });
    expect(await issueBoqCore(owner, { boqId: boq.boqId, locale: 'en' })).toEqual({ ok: false, error: 'boq_needs_delivery' });
  });
});
