import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEngagementDetail } from '@/app/[locale]/(app)/engagements/[id]/engagement-detail-data';
import { contractPayloadHash } from '@/lib/contracts/public';
import type { PublicContract } from '@/lib/contracts/public-types';
import { countProjectDeliveries, getEngagementByProject } from '@/lib/engagements/queries/by-project';
import { executionCardFactsOf, type StagedContract } from '@/lib/execution/flow-facts';
import { executionFlowSourceOf } from '@/lib/execution/flow-source';
import { getContractPageExecution, getExecutionFacts } from '@/lib/execution/queries/facts';
import { executionStage } from '@/lib/execution/stage';
import { locateExecutionForClient } from '@/lib/flow/locate/execution-client';
import { locateExecutionForStudio } from '@/lib/flow/locate/execution-studio';
import { mintShareToken } from '@/lib/share/token';
import { homeBySql, seedHome, seedLightHome, setClientEmail } from './client-home-fixture';
import { seedDelivery } from './delivery-execution-fixture';
import { seedPayment } from './execution-billing-fixture';
import {
  appQuery,
  closeExecutionFixture,
  ownerQuery,
  seedClientProject,
  seedExecutionContract,
  seedRequest,
  seedVariation,
  sqlstate,
  tamper,
} from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';
import { setStudioDetails } from './round-c-org-fixture';
import type { OrgContext } from '@/lib/db/context';

// Client home DB step C, the reads (rls/functions/75-client-home.sql and
// 65-execution-facts.sql): the home by its token, the contract and change
// orders it shows through the /c and /v functions, the ONE fact source the
// cockpit and the home share (the parity ruling), the light delivery (0065)
// and its CHECKs (AC1 to AC3, AC6, AC26 to AC28 at the SQL level).

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let ownerId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'project_manager' }] });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  owner = ctxFor(orgId, ownerId, 'owner');
  orgIds.push(orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

type Json = Record<string, unknown>;

const scalar = async <T>(text: string, params: unknown[] = []): Promise<T> =>
  (await ownerQuery<{ value: T }>(`select ${text} as value`, params))[0].value;

/** The client's flow facts, derived from the home exactly as the studio's are. */
async function clientFlow(tokenHash: string) {
  const home = await homeBySql<{ execution: { flow_source: unknown } }>(tokenHash);
  return executionCardFactsOf(executionFlowSourceOf(home?.execution.flow_source)).flow;
}

describe('app_home_by_token: the home, by its token (AC1)', () => {
  it('answers the same null for an unknown, a revoked and an expired link, a light delivery\'s included', async () => {
    const home = await seedHome(orgId);
    const light = await seedLightHome(orgId);
    expect(await homeBySql(home.delivery.tokenHash)).not.toBeNull();
    expect(await homeBySql(light.delivery.tokenHash)).not.toBeNull();
    expect(await homeBySql('f'.repeat(64))).toBeNull();
    expect(await homeBySql(null)).toBeNull();
    await tamper(`update public.design_engagements set share_expires_at = now() - interval '1 second' where id = $1`, [home.delivery.id]);
    expect(await homeBySql(home.delivery.tokenHash)).toBeNull();
    await ownerQuery(`update public.design_engagements set token_hash = null, token_nonce = null where id = $1`, [light.delivery.id]);
    expect(await homeBySql(light.delivery.tokenHash)).toBeNull();
  });

  it('carries the delivery, the firm block of app_delivery_by_token, the client and the code channel', async () => {
    const home = await seedHome(orgId);
    await setStudioDetails(orgId, { studio_phone: '+201000000001', studio_whatsapp: '+201000000002' });
    const read = await homeBySql<Json>(home.delivery.tokenHash);
    const delivery = await scalar<Json>(`public.app_delivery_by_token($1)`, [home.delivery.tokenHash]);
    expect(read?.firm).toEqual(delivery.firm);
    expect(read?.firm).toMatchObject({ phone: '+201000000001', whatsapp: '+201000000002' });
    expect(read?.client).toEqual(delivery.client);
    expect(read?.delivery).toMatchObject({ number: delivery.number, title_en: 'Villa', entry_phase: 'design', phase: 'execution' });
    expect(read?.code_channel).toEqual({ hint: 'c•••@e•••.com' });
    await setClientEmail(orgId, home.delivery.clientId, null);
    expect((await homeBySql<Json>(home.delivery.tokenHash))?.code_channel).toBeNull();
  });

  it('says the phase: design before execution with no execution block, closed once abandoned', async () => {
    const designing = await seedDelivery(orgId, { state: 'design_proposal' });
    const read = await homeBySql<Json>(designing.tokenHash);
    expect(read?.delivery).toMatchObject({ phase: 'design', entry_phase: 'design' });
    expect(read?.execution).toBeNull();
    const abandoned = await seedDelivery(orgId, { state: 'abandoned' });
    expect((await homeBySql<Json>(abandoned.tokenHash))?.delivery).toMatchObject({ phase: 'closed' });
  });

  it('at execution: the contract summary, the money card of app_delivery_execution_by_token, no cost key', async () => {
    const home = await seedHome(orgId, 'signed');
    await seedVariation(orgId, home.contract, 'approved', { timeExtensionDays: 15 });
    const read = await homeBySql<{ execution: Json }>(home.delivery.tokenHash);
    expect(read?.execution.contract).toEqual({
      id: home.contract.contractId,
      number: home.contract.contractNumber,
      year: expect.any(Number),
      status: 'signed',
      signing_open: false,
      signed: null,
      terminated_at: null,
      end_date: '2026-12-31',
      time_extension_days_total: 15,
    });
    expect(read?.execution.previous_contract).toBeNull();
    expect(read?.execution.money).toEqual(await scalar(`public.app_delivery_execution_by_token($1)`, [home.delivery.tokenHash]));
    expect(JSON.stringify(read)).not.toMatch(/cost|margin/i);
  });
});

describe('the home shows /c and /v by their own functions (AC2)', () => {
  it('the contract is app_contract_by_token of the stored hash, byte for byte, and hashes the same', async () => {
    const home = await seedHome(orgId, 'issued');
    const contractHash = (await ownerQuery<{ token_hash: string }>(`select token_hash from public.contracts where id = $1`, [home.contract.contractId]))[0].token_hash;
    const viaHome = await scalar<PublicContract>(`public.app_home_contract_by_token($1)`, [home.delivery.tokenHash]);
    const viaLink = await scalar<PublicContract>(`public.app_contract_by_token($1)`, [contractHash]);
    expect(viaHome).toEqual(viaLink);
    const textEqual = await scalar<boolean>(`public.app_home_contract_by_token($1)::text = public.app_contract_by_token($2)::text`, [
      home.delivery.tokenHash,
      contractHash,
    ]);
    expect(textEqual).toBe(true);
    expect(contractPayloadHash(viaHome)).toBe(contractPayloadHash(viaLink));
    const [section] = home.contract.sectionIds;
    expect(await scalar(`public.app_home_contract_sections_by_token($1, 0)`, [home.delivery.tokenHash])).toEqual(
      await scalar(`public.app_contract_sections_by_token($1, 0)`, [contractHash]),
    );
    expect(await scalar(`public.app_home_contract_section_lines_by_token($1, $2::uuid, 0)`, [home.delivery.tokenHash, section])).toEqual(
      await scalar(`public.app_contract_section_lines_by_token($1, $2::uuid, 0)`, [contractHash, section]),
    );
    const other = await seedHome(orgId, 'issued');
    expect(await scalar(`public.app_home_contract_section_lines_by_token($1, $2::uuid, 0)`, [home.delivery.tokenHash, other.contract.sectionIds[0]])).toBeNull();
  });

  it('answers null for a draft contract, a link that is not live and a delivery not at execution', async () => {
    const draft = await seedHome(orgId, 'draft');
    expect(await scalar(`public.app_home_contract_by_token($1)`, [draft.delivery.tokenHash])).toBeNull();
    const issued = await seedHome(orgId, 'issued');
    await tamper(`update public.design_engagements set share_expires_at = now() - interval '1 second' where id = $1`, [issued.delivery.id]);
    for (const fn of ['app_home_contract_by_token($1)', 'app_home_contract_sections_by_token($1, 0)', 'app_home_variations_by_token($1)']) {
      expect({ fn, value: await scalar(`public.${fn}`, [issued.delivery.tokenHash]) }).toEqual({ fn, value: null });
    }
    const designing = await seedDelivery(orgId, { state: 'design_proposal' });
    expect(await scalar(`public.app_home_contract_by_token($1)`, [designing.tokenHash])).toBeNull();
  });

  it('change orders: the newest 10 issued as /v shows each, and the newest 20 decided with their day', async () => {
    const home = await seedHome(orgId, 'signed');
    const issued: Array<{ id: string; hash: string }> = [];
    for (let index = 0; index < 11; index += 1) {
      const hash = `${randomUUID()}-open-${String(index)}`;
      issued.push({ id: (await seedVariation(orgId, home.contract, 'issued', { tokenHash: hash })).id, hash });
    }
    const approved = await seedVariation(orgId, home.contract, 'approved', { netDelta: '2500' });
    await ownerQuery(
      `insert into public.variation_order_events (org_id, variation_order_id, kind, actor_channel, from_status, to_status, decided_at)
       values ($1, $2, 'issued', 'staff', 'internal_approved', 'issued', '2026-10-19T10:00:00Z'),
              ($1, $2, 'approved', 'client', 'issued', 'approved', '2026-10-20T22:30:00Z')`,
      [orgId, approved.id],
    );
    const other = await seedHome(orgId, 'signed');
    await seedVariation(orgId, other.contract, 'issued', { tokenHash: `${randomUUID()}-foreign` });
    const read = await scalar<{ open: Json[]; decided: Json[] }>(`public.app_home_variations_by_token($1)`, [home.delivery.tokenHash]);
    expect(read.open).toHaveLength(10);
    const newestFirst = [...issued].reverse().slice(0, 10);
    for (const [index, order] of newestFirst.entries()) {
      expect(read.open[index]).toEqual(await scalar(`public.app_variation_by_token($1)`, [order.hash]));
    }
    expect(read.decided).toEqual([
      { id: approved.id, number: approved.number, year: expect.any(Number), status: 'approved', net_delta: '2500.0000', decided_on: '2026-10-21' },
    ]);
  });
});

describe('the bodies are client-safe (AC3)', () => {
  it('no client home function names a cost, a margin or the supervision word', async () => {
    const sources = await ownerQuery<{ proname: string; prosrc: string }>(
      `select proname, prosrc from pg_proc where pronamespace = 'public'::regnamespace and (
         proname like 'app_home%' or proname in ('app_client_code_destination', 'app_email_hint', 'app_client_code_check',
           'app_client_code_refusal', 'app_client_code_consume', 'enforce_client_code_guarded', 'app_client_home_target_by_token',
           'app_delivery_boqs', 'app_contract_measured_lines', 'app_contract_measured_works', 'app_contract_money_facts',
           'app_payment_request_due', 'app_engagement_milestone_due', 'app_contract_signed', 'app_contract_time_extension_days',
           'app_contract_terminated_at', 'app_delivery_current_contract'))`,
    );
    expect(sources.length).toBe(30);
    for (const source of sources) {
      expect({ fn: source.proname, forbidden: /cost|margin|supervision/i.test(source.prosrc) }).toEqual({ fn: source.proname, forbidden: false });
    }
  });

  it('the fact source names the supervision RATE only, the client charge /c shows, and no cost or margin', async () => {
    const [source] = await ownerQuery<{ prosrc: string }>(`select prosrc from pg_proc where proname = 'app_execution_flow_source'`);
    expect(source.prosrc).not.toMatch(/cost|margin/i);
    expect(source.prosrc.match(/supervision\w*/gi)).toEqual(['supervision_pct', 'supervision_pct', 'supervision_pct']);
  });
});

describe('ONE fact source for the cockpit and the home (the parity ruling)', () => {
  async function expectParity(engagementId: string, tokenHash: string) {
    const studio = (await getExecutionFacts(owner, engagementId)).flow;
    const client = await clientFlow(tokenHash);
    expect(client).toEqual(studio);
    expect(locateExecutionForClient(client).step).toBe(locateExecutionForStudio(studio).step);
    return studio;
  }

  it('the same facts at every stage of one delivery, from no BOQ to the final account', async () => {
    const delivery = await seedDelivery(orgId);
    await setClientEmail(orgId, delivery.clientId, 'x@y.eg');
    expect((await expectParity(delivery.id, delivery.tokenHash)).stage).toEqual({ hasIssuedBoq: false, contract: null });

    const contract = await seedExecutionContract(orgId, {
      state: 'issued',
      delivery,
      schedule: [
        { labelEn: 'Advance', basis: 'percent', value: '50' },
        { labelEn: 'Rest', basis: 'percent', value: '50' },
      ],
    });
    expect((await expectParity(delivery.id, delivery.tokenHash)).signingOpen).toBe(true);
    await tamper(`update public.contracts set share_expires_at = now() - interval '1 second' where id = $1`, [contract.contractId]);
    expect((await expectParity(delivery.id, delivery.tokenHash)).signingOpen).toBe(false);

    await ownerQuery(`update public.contracts set status = 'signed' where id = $1`, [contract.contractId]);
    const milestones = await ownerQuery<{ id: string }>(`select id from public.contract_payment_milestones where contract_id = $1 order by sort_order`, [contract.contractId]);
    const first = await seedRequest(orgId, contract.contractId, ownerId, { milestoneId: milestones[0].id }, '62000');
    await seedPayment(orgId, contract.contractId, first, ownerId, '1000');
    const second = await seedRequest(orgId, contract.contractId, ownerId, { milestoneId: milestones[1].id }, '62000');
    await ownerQuery(`insert into public.contract_payment_claims (org_id, contract_id, request_id, claimed_amount) values ($1, $2, $3, 62000)`, [
      orgId,
      contract.contractId,
      second,
    ]);
    await seedVariation(orgId, contract, 'issued', { tokenHash: `${randomUUID()}-live` });
    const expired = await seedVariation(orgId, contract, 'issued', { tokenHash: `${randomUUID()}-old` });
    await tamper(`update public.variation_orders set share_expires_at = now() - interval '1 day' where id = $1`, [expired.id]);
    await seedVariation(orgId, contract, 'internal_approved', { tokenHash: `${randomUUID()}-inert` });
    await seedVariation(orgId, contract, 'approved', { netDelta: '5000' });
    const busy = await expectParity(delivery.id, delivery.tokenHash);
    expect(busy).toMatchObject({ issuedChangeOrderCount: 1, expiredChangeOrderCount: 1, unclaimedDueRequestCount: 1 });
    expect(busy.stage.contract).toMatchObject({ pendingClaimCount: 1, unpaidRequestCount: 2, openVariationCount: 3, unbilledVariationCount: 1 });

    await tamper(`delete from public.variation_orders where contract_id = $1 and status in ('issued', 'internal_approved')`, [contract.contractId]);
    await seedRequest(orgId, contract.contractId, ownerId, {}, '1000');
    expect((await expectParity(delivery.id, delivery.tokenHash)).stage.contract?.finalAccountOutstanding).toBe('1000.0000');

    await tamper(`update public.contracts set status = 'terminated' where id = $1`, [contract.contractId]);
    expect((await expectParity(delivery.id, delivery.tokenHash)).stage.contract?.status).toBe('terminated');
  });

  it('a draft is the studio\'s alone: the home sees no contract, and both stand on the contract step', async () => {
    const home = await seedHome(orgId, 'draft');
    const studio = (await getExecutionFacts(owner, home.delivery.id)).flow;
    const client = await clientFlow(home.delivery.tokenHash);
    expect(studio.stage.contract?.status).toBe('draft');
    expect(client).toEqual({ ...studio, stage: { hasIssuedBoq: true, contract: null } });
    expect(locateExecutionForClient(client)).toMatchObject({ step: 'contract', reason: 'preparing_contract' });
    expect(locateExecutionForStudio(studio).step).toBe('contract');
  });

  it('the money facts the cores read are the same statement: one row of zeros for a contract the caller cannot see', async () => {
    const home = await seedHome(orgId, 'signed');
    const theirs = await seedOrg({ owners: 1 });
    orgIds.push(theirs.orgId);
    const [visible] = await appQuery<{ facts: Json }>(orgId, ownerId, `select public.app_contract_money_facts($1) as facts`, [home.contract.contractId]);
    const [hidden] = await appQuery<{ facts: Json }>(theirs.orgId, theirs.ownerIds[0], `select public.app_contract_money_facts($1) as facts`, [
      home.contract.contractId,
    ]);
    expect(visible.facts).toMatchObject({ unpaid_requests: 0, issued_total: '0', final_account: null });
    expect(hidden.facts).toEqual(visible.facts);
    const [none] = await appQuery<{ source: Json | null }>(theirs.orgId, theirs.ownerIds[0], `select public.app_execution_flow_source($1) as source`, [
      home.delivery.id,
    ]);
    expect(none.source).toBeNull();
  });
});

describe('the light delivery (0065): its CHECKs (AC6)', () => {
  it('is born at execution only, once per project and client, and metra_app cannot change its entry phase', async () => {
    const { clientId, projectId } = await seedClientProject(orgId);
    const insert = (state: string, entry: string) =>
      ownerQuery(
        `insert into public.design_engagements (org_id, number, client_id, project_id, state, entry_phase, title_en)
         values ($1, (select coalesce(max(number), 0) + 1 from public.design_engagements where org_id = $1), $2, $3, $4, $5, 'Light')`,
        [orgId, clientId, projectId, state, entry],
      );
    expect(await sqlstate(insert('created', 'execution'))).toBe('23514');
    expect(await sqlstate(insert('execution', 'site'))).toBe('23514');
    expect(await sqlstate(insert('execution', 'execution'))).toBeNull();
    const second = await sqlstate(insert('execution', 'execution'));
    expect(second).toBe('23505');
    const [light] = await ownerQuery<{ id: string }>(`select id from public.design_engagements where project_id = $1`, [projectId]);
    expect(await sqlstate(ownerQuery(`update public.design_engagements set state = 'abandoned' where id = $1`, [light.id]))).toBe('23514');
    const appWrite = appQuery(orgId, ownerId, `update public.design_engagements set entry_phase = 'design' where id = $1`, [light.id]);
    expect(await sqlstate(appWrite)).toBe('42501');
    expect(await sqlstate(insert('execution', 'design'))).toBeNull();
  });

  it('two clients of one project each get their own; a second one for the same client is refused (23505)', async () => {
    const { clientId, projectId } = await seedClientProject(orgId);
    const [other] = await ownerQuery<{ id: string }>(`insert into public.clients (org_id, name_en) values ($1, 'Client B') returning id`, [orgId]);
    const insertLight = (client: string) =>
      ownerQuery(
        `insert into public.design_engagements (org_id, number, client_id, project_id, state, entry_phase, title_en)
         values ($1, (select coalesce(max(number), 0) + 1 from public.design_engagements where org_id = $1), $2, $3, 'execution', 'execution', 'Light')`,
        [orgId, client, projectId],
      );
    expect(await sqlstate(insertLight(clientId))).toBeNull();
    expect(await sqlstate(insertLight(other.id))).toBeNull();
    expect(await sqlstate(insertLight(clientId))).toBe('23505');
    expect(await sqlstate(insertLight(other.id))).toBe('23505');
    const lights = await ownerQuery<{ client_id: string }>(
      `select client_id from public.design_engagements where project_id = $1 and entry_phase = 'execution' order by client_id`,
      [projectId],
    );
    expect(lights.map((light) => light.client_id)).toEqual([clientId, other.id].sort());
  });
});

describe('the light delivery: found by its project everywhere a delivery finds its contract (AC26 to AC28)', () => {
  it('its card, its claims and its cockpit read the project\'s unattached BOQ contract', async () => {
    const light = await seedLightHome(orgId, 'signed');
    const card = await scalar<{ contract: Json }>(`public.app_delivery_execution_by_token($1)`, [light.delivery.tokenHash]);
    expect(card.contract).toMatchObject({ number: light.contract.contractNumber, status: 'signed' });
    const request = await seedRequest(orgId, light.contract.contractId, ownerId, { milestoneId: light.contract.milestoneIds[0] }, '100');
    expect(
      await scalar(`public.app_delivery_claim_request_by_token($1, $2::uuid, null, 'Client', null, null)`, [light.delivery.tokenHash, request]),
    ).toBe('ok');

    const facts = await getExecutionFacts(owner, light.delivery.id);
    expect(facts.contract).toMatchObject({ id: light.contract.contractId, status: 'signed' });
    expect(facts.boqId).toBe(light.contract.boqId);
    const [basis] = await ownerQuery<StagedContract>(
      `select id, status::text as status, original_value::text as "originalValue", tax_amount::text as "taxAmount",
              tax_rate::text as "taxRate", supervision_pct::text as "supervisionPct", discount_pct::text as "discountPct"
         from public.contracts where id = $1`,
      [light.contract.contractId],
    );
    const page = await getContractPageExecution(owner, basis, { schedule: false });
    expect(executionStage(facts.flow.stage).stage).toBe(page.stage);
    expect(await clientFlow(light.delivery.tokenHash)).toEqual(facts.flow);
  });

  it('a design delivery of the same project never shows the unattached BOQ\'s contract', async () => {
    const light = await seedLightHome(orgId, 'signed');
    const token = mintShareToken();
    const [design] = await ownerQuery<{ id: string }>(
      `insert into public.design_engagements (org_id, number, client_id, project_id, state, title_en, token_hash)
       values ($1, (select coalesce(max(number), 0) + 1 from public.design_engagements where org_id = $1), $2, $3, 'execution', 'Design', $4)
       returning id`,
      [orgId, light.delivery.clientId, light.delivery.projectId, token.hash],
    );
    expect(await scalar(`public.app_delivery_execution_by_token($1)`, [token.hash])).toBeNull();
    expect((await getExecutionFacts(owner, design.id)).contract).toBeNull();
  });

  it('the cockpit loader and the project panel take a light delivery as any delivery at execution', async () => {
    const light = await seedLightHome(orgId, 'issued');
    const detail = await loadEngagementDetail(owner, light.delivery.id);
    expect(detail?.header.state).toBe('execution');
    expect(detail?.execution?.contract).toMatchObject({ id: light.contract.contractId, status: 'issued' });
    expect(await getEngagementByProject(owner, light.delivery.projectId)).toMatchObject({ id: light.delivery.id, state: 'execution' });
    // Ruling D14: a light delivery is not counted toward the project delivery cap.
    expect(await countProjectDeliveries(owner, light.delivery.projectId)).toBe(0);
  });
});
