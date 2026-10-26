import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { terminateContractCore } from '@/lib/contracts/lifecycle/terminate';
import type { OrgContext } from '@/lib/db/context';
import { executionCardFactsOf } from '@/lib/execution/flow-facts';
import { executionFlowSourceOf } from '@/lib/execution/flow-source';
import { getExecutionFacts } from '@/lib/execution/queries/facts';
import { locateExecutionForClient } from '@/lib/flow/locate/execution-client';
import { locateExecutionForStudio } from '@/lib/flow/locate/execution-studio';
import { homeBySql, requestCode, seedLightHome, setClientEmail } from './client-home-fixture';
import { seedDelivery, type SeededDelivery } from './delivery-execution-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedVariation, tamper, type ContractState } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';
import { callsDuring } from './function-calls';

// Client home DB step C, the H3 fix round on the home's reads
// (rls/functions/65-execution-facts.sql, 70-execution-portal.sql,
// 75-client-home.sql):
//  - F5: ONE picker for "the contract": the home's summary, its money card,
//    its fact source and the studio's cockpit stand on the same row, and a
//    terminated contract a newer BOQ replaced is only the previous contract;
//  - F6: the summary and the previous contract carry the termination's time;
//  - S2, S6: a delivery owns only its own client's BOQs;
//  - S4: the fact source the client holds counts only what the client sees;
//  - R2: the home evaluates its costly helpers once;
//  - F3, F4: the change-order lists hold only what was put to the client, and
//    the open list only what the client can still answer.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'project_manager' }] });
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  orgIds.push(orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

type Json = Record<string, unknown>;

interface HomeExecution {
  contract: { id: string; number: number; status: string; terminated_at: string | null } | null;
  previous_contract: { status: string; terminated_at: string } | null;
  flow_source: { issued_boq_id: string | null; contract: Json | null };
  money: { contract: { number: number } } | null;
}

async function executionOf(tokenHash: string): Promise<HomeExecution> {
  const home = await homeBySql<{ execution: HomeExecution }>(tokenHash);
  if (!home) throw new Error('the home did not answer');
  return home.execution;
}

/** A delivery at execution, the client's email on file. */
async function seedExecutionHome(): Promise<SeededDelivery> {
  const delivery = await seedDelivery(orgId);
  await setClientEmail(orgId, delivery.clientId, 'client@example.com');
  return delivery;
}

/** A contract of the delivery, terminated by the studio's own core, its BOQ then superseded. */
async function terminatedAndReplaced(delivery: SeededDelivery) {
  const ended = await seedExecutionContract(orgId, { state: 'signed', delivery });
  expect((await terminateContractCore(owner, { id: ended.contractId })).ok).toBe(true);
  await ownerQuery(`update public.boqs set status = 'superseded' where id = $1`, [ended.boqId]);
  return ended;
}

/** The newer issued BOQ of the delivery, with no contract yet. */
async function seedIssuedBoq(delivery: SeededDelivery): Promise<string> {
  const [boq] = await ownerQuery<{ id: string }>(
    `insert into public.boqs (org_id, number, title_en, client_id, project_id, engagement_id, status, total, subtotal)
     values ($1, (select coalesce(max(number), 0) + 1 from public.boqs where org_id = $1), 'Newer BOQ', $2, $3, $4, 'draft', 0, 0)
     returning id`,
    [orgId, delivery.clientId, delivery.projectId, delivery.id],
  );
  await ownerQuery(`update public.boqs set status = 'issued' where id = $1`, [boq.id]);
  return boq.id;
}

async function terminatedAt(contractId: string): Promise<string> {
  const [row] = await ownerQuery<{ at: string }>(
    `select to_jsonb(decided_at) #>> '{}' as at from public.contract_events where contract_id = $1 and kind = 'terminated'`,
    [contractId],
  );
  return row.at;
}

/** Both sides on the same step, from the same facts but for the client's masks. */
async function expectSameStep(delivery: SeededDelivery, execution: HomeExecution) {
  const studio = (await getExecutionFacts(owner, delivery.id)).flow;
  const client = executionCardFactsOf(executionFlowSourceOf(execution.flow_source)).flow;
  expect(locateExecutionForClient(client).step).toBe(locateExecutionForStudio(studio).step);
  return { studio, client };
}

describe('F5, F6: one contract per home, the one the studio stands on', () => {
  it('a terminated contract a newer issued BOQ replaced is the previous contract only, on every read', async () => {
    const delivery = await seedExecutionHome();
    const ended = await terminatedAndReplaced(delivery);
    const boqId = await seedIssuedBoq(delivery);
    const execution = await executionOf(delivery.tokenHash);
    expect(execution.contract).toBeNull();
    expect(execution.previous_contract).toEqual({ status: 'terminated', terminated_at: await terminatedAt(ended.contractId) });
    expect(execution.flow_source).toEqual({ issued_boq_id: boqId, contract: null });
    expect(execution.money).toBeNull();
    const facts = await getExecutionFacts(owner, delivery.id);
    expect(facts).toMatchObject({ boqId, contract: null });
    const { studio, client } = await expectSameStep(delivery, execution);
    expect(client).toEqual(studio);
    expect(locateExecutionForClient(client)).toMatchObject({ step: 'contract', reason: 'preparing_contract' });
  });

  it('the replacement is a draft: the studio works on it, the client sees none yet and the previous one', async () => {
    const delivery = await seedExecutionHome();
    const ended = await terminatedAndReplaced(delivery);
    await seedExecutionContract(orgId, { state: 'draft', delivery });
    const execution = await executionOf(delivery.tokenHash);
    expect(execution.contract).toBeNull();
    expect(execution.flow_source.contract).toBeNull();
    expect(execution.previous_contract).toEqual({ status: 'terminated', terminated_at: await terminatedAt(ended.contractId) });
    const { studio } = await expectSameStep(delivery, execution);
    expect(studio.stage.contract?.status).toBe('draft');
  });

  it('the replacement is issued: the summary, the money card and the fact source name it, the old one is previous', async () => {
    const delivery = await seedExecutionHome();
    const ended = await terminatedAndReplaced(delivery);
    const next = await seedExecutionContract(orgId, { state: 'issued', delivery });
    const execution = await executionOf(delivery.tokenHash);
    expect(execution.contract).toMatchObject({ id: next.contractId, status: 'issued', terminated_at: null });
    expect(execution.flow_source.contract).toMatchObject({ id: next.contractId });
    expect(execution.money?.contract.number).toBe(next.contractNumber);
    expect(execution.previous_contract).toEqual({ status: 'terminated', terminated_at: await terminatedAt(ended.contractId) });
    const { studio, client } = await expectSameStep(delivery, execution);
    expect(client).toEqual(studio);
  });

  it('a terminated contract nothing replaced is the contract, with its termination time, and no previous one', async () => {
    const delivery = await seedExecutionHome();
    const ended = await seedExecutionContract(orgId, { state: 'signed', delivery });
    expect((await terminateContractCore(owner, { id: ended.contractId })).ok).toBe(true);
    const execution = await executionOf(delivery.tokenHash);
    expect(execution.contract).toMatchObject({ id: ended.contractId, status: 'terminated', terminated_at: await terminatedAt(ended.contractId) });
    expect(execution.flow_source.contract).toMatchObject({ id: ended.contractId, status: 'terminated' });
    expect(execution.money?.contract.number).toBe(ended.contractNumber);
    expect(execution.previous_contract).toBeNull();
    const { studio, client } = await expectSameStep(delivery, execution);
    expect(client).toEqual(studio);
  });
});

describe('S2, S6: a delivery owns only its own client\'s BOQs', () => {
  async function reassign(projectId: string): Promise<string> {
    const [other] = await ownerQuery<{ id: string }>(`insert into public.clients (org_id, name_en) values ($1, 'Client B') returning id`, [orgId]);
    await ownerQuery(`update public.projects set client_id = $2 where id = $1`, [projectId, other.id]);
    return other.id;
  }

  const contractHash = async (contractId: string) =>
    (await ownerQuery<{ token_hash: string }>(`select token_hash from public.contracts where id = $1`, [contractId]))[0].token_hash;

  it('a light home keeps its client\'s contract after the project changes client: no read, code or redirect reaches the other\'s', async () => {
    const light = await seedLightHome(orgId, 'signed');
    const clientB = await reassign(light.delivery.projectId);
    const theirs = await seedExecutionContract(orgId, { state: 'issued', project: { clientId: clientB, projectId: light.delivery.projectId } });
    const execution = await executionOf(light.delivery.tokenHash);
    expect(execution.contract?.id).toBe(light.contract.contractId);
    expect(execution.flow_source.contract).toMatchObject({ id: light.contract.contractId });
    expect((await requestCode(light.delivery.tokenHash, 'sign_contract', theirs.contractId)).answer).toEqual({ status: 'not_available' });
    const [target] = await ownerQuery<{ target: Json | null }>(`select public.app_client_home_target_by_token('contract', $1) as target`, [
      await contractHash(theirs.contractId),
    ]);
    expect(target.target).toBeNull();
  });

  it('a design delivery shows none of a BOQ made on it for the project\'s new client', async () => {
    const delivery = await seedExecutionHome();
    const own = await seedExecutionContract(orgId, { state: 'signed', delivery });
    const clientB = await reassign(delivery.projectId);
    const theirs = await seedExecutionContract(orgId, { state: 'issued', delivery: { ...delivery, clientId: clientB } });
    expect((await executionOf(delivery.tokenHash)).contract?.id).toBe(own.contractId);
    expect((await getExecutionFacts(owner, delivery.id)).contract?.id).toBe(own.contractId);
    expect((await requestCode(delivery.tokenHash, 'sign_contract', theirs.contractId)).answer).toEqual({ status: 'not_available' });
  });
});

describe('S4: the fact source as the client holds it', () => {
  it('names only the client-safe keys, and counts the studio\'s internal change orders as one at most', async () => {
    const delivery = await seedExecutionHome();
    const contract = await seedExecutionContract(orgId, { state: 'signed', delivery });
    await seedVariation(orgId, contract, 'issued', { tokenHash: `${randomUUID()}-live` });
    await seedVariation(orgId, contract, 'internal_approved', { tokenHash: `${randomUUID()}-inner-1` });
    await seedVariation(orgId, contract, 'internal_approved', { tokenHash: `${randomUUID()}-inner-2` });
    const source = (await executionOf(delivery.tokenHash)).flow_source as unknown as { contract: Json & { money: Json } };
    expect(Object.keys(source).sort()).toEqual(['contract', 'issued_boq_id']);
    expect(Object.keys(source.contract).sort()).toEqual([
      'created_at', 'discount_pct', 'id', 'measured_works', 'money', 'number', 'original_value', 'schedule',
      'signing_open', 'status', 'supervision_pct', 'tax_amount', 'tax_rate',
    ]);
    expect(Object.keys(source.contract.money).sort()).toEqual([
      'approved_deltas', 'billed_milestones', 'expired_variations', 'final_account', 'issued_total', 'issued_variations',
      'open_variations', 'pending_claims', 'unbilled_variations', 'unclaimed_due_requests', 'unpaid_requests',
    ]);
    expect(source.contract.money).toMatchObject({ open_variations: 2, issued_variations: 1, expired_variations: 0 });
    const { studio, client } = await expectSameStep(delivery, await executionOf(delivery.tokenHash));
    expect(studio.stage.contract?.openVariationCount).toBe(3);
    expect(client.stage.contract?.openVariationCount).toBe(2);
    expect({ ...client, stage: { ...client.stage, contract: { ...client.stage.contract, openVariationCount: 3 } } }).toEqual(studio);
  });

  it('with only internal change orders open, the client still waits with the studio, never "settled"', async () => {
    const delivery = await seedExecutionHome();
    const contract = await seedExecutionContract(orgId, { state: 'signed', delivery });
    await tamper(`update public.contracts set original_value = 0, tax_amount = 0, supervision_amount = 0 where id = $1`, [contract.contractId]);
    await seedVariation(orgId, contract, 'internal_approved', { tokenHash: `${randomUUID()}-inner` });
    const { studio, client } = await expectSameStep(delivery, await executionOf(delivery.tokenHash));
    expect(client.stage.contract?.openVariationCount).toBe(1);
    expect(locateExecutionForStudio(studio).step).toBe('works');
  });
});

describe('R2: the home evaluates its costly helpers once', () => {
  it('one fact source and one address lookup per call', async () => {
    const delivery = await seedExecutionHome();
    await seedExecutionContract(orgId, { state: 'signed', delivery });
    const signatures = ['public.app_execution_flow_source(uuid)', 'public.app_client_code_destination(uuid,uuid)'] as const;
    const calls = await callsDuring(signatures, (tx) => tx.execute(sql`select public.app_home_by_token(${delivery.tokenHash})`));
    expect(calls).toEqual({ 'public.app_execution_flow_source(uuid)': 1, 'public.app_client_code_destination(uuid,uuid)': 1 });
  });
});

describe('F3, F4: the change orders the client is shown', () => {
  async function markIssued(variationId: string): Promise<void> {
    await ownerQuery(
      `insert into public.variation_order_events (org_id, variation_order_id, kind, actor_channel, from_status, to_status)
       values ($1, $2, 'issued', 'staff', 'internal_approved', 'issued')`,
      [orgId, variationId],
    );
  }

  async function contractWith(state: ContractState) {
    const delivery = await seedExecutionHome();
    return { delivery, contract: await seedExecutionContract(orgId, { state, delivery }) };
  }

  const variationsOf = async (tokenHash: string) =>
    (await ownerQuery<{ list: { open: Json[]; expired: Json[]; decided: Json[] } }>(`select public.app_home_variations_by_token($1) as list`, [tokenHash]))[0].list;

  it('decided: only orders that were put to the client, never an internal one the termination rejected', async () => {
    const { delivery, contract } = await contractWith('signed');
    const answered = await seedVariation(orgId, contract, 'issued', { tokenHash: `${randomUUID()}-answered` });
    await markIssued(answered.id);
    await seedVariation(orgId, contract, 'internal_approved', { tokenHash: `${randomUUID()}-internal` });
    expect((await terminateContractCore(owner, { id: contract.contractId })).ok).toBe(true);
    const list = await variationsOf(delivery.tokenHash);
    expect(list.decided.map((order) => [order.id, order.status])).toEqual([[answered.id, 'rejected']]);
  });

  it('open: only live links, so the facts\' count is the list\'s length; at most 10 expired ones listed apart, newest first', async () => {
    const { delivery, contract } = await contractWith('signed');
    const live = await seedVariation(orgId, contract, 'issued', { tokenHash: `${randomUUID()}-live` });
    const lapsed: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      const order = await seedVariation(orgId, contract, 'issued', { tokenHash: `${randomUUID()}-lapsed-${String(index)}` });
      await tamper(`update public.variation_orders set share_expires_at = now() - interval '1 day' where id = $1`, [order.id]);
      lapsed.push(order.id);
    }
    const list = await variationsOf(delivery.tokenHash);
    expect(list.open.map((order) => order.id)).toEqual([live.id]);
    expect(list.expired.map((order) => order.id)).toEqual([...lapsed].reverse().slice(0, 10));
    const money = (await executionOf(delivery.tokenHash)).flow_source.contract?.money as Json;
    expect(money).toMatchObject({ issued_variations: list.open.length, expired_variations: 11 });
  });
});
