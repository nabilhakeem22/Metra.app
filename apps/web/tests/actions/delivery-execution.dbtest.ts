import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimExecutionRequestByToken, getDeliveryExecutionByToken } from '@/lib/engagements/public/execution';
import { hashShareToken } from '@/lib/share/token';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedRequest, seedVariation } from './execution-fixture';
import { seedPayment } from './execution-billing-fixture';
import {
  claimBySql,
  claimNotifications,
  claimsOf,
  dismissBySql,
  seedDelivery,
  seedExecutionDelivery,
  type ExecutionDelivery,
} from './delivery-execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';
import { setStudioDetails } from './round-c-org-fixture';

// PR B4.1, the /d SQL of DB step B (rls/functions/70-execution-portal.sql):
// the client's execution card and the client's "I paid" (AC32 to AC35).

const orgIds: string[] = [];
let orgId: string;
let members: Record<string, string>;

beforeAll(async () => {
  const seeded = await seedOrg({
    owners: 1,
    members: [
      { role: 'admin' },
      { role: 'project_manager' },
      { role: 'site_engineer' },
      { role: 'accountant' },
      { role: 'viewer' },
      { role: 'client' },
    ],
  });
  orgId = seeded.orgId;
  orgIds.push(orgId);
  const [admin, pm, siteEngineer, accountant, viewer, client] = seeded.memberIds;
  members = { owner: seeded.ownerIds[0], admin, pm, siteEngineer, accountant, viewer, client };
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const readSql = async (hash: string | null) =>
  (await ownerQuery<{ data: Record<string, unknown> | null }>(`select public.app_delivery_execution_by_token($1) as data`, [hash]))[0].data;

const FORBIDDEN = /cost|margin|supervision/i;

describe('app_delivery_execution_by_token: null unless execution, live and contracted (AC32)', () => {
  it('answers null for another stage, an expired link, no BOQ contract, a draft contract and an unknown token', async () => {
    const atBoq = await seedDelivery(orgId, { state: 'boq' });
    await seedExecutionContract(orgId, { state: 'signed', delivery: atBoq });
    const expired = await seedDelivery(orgId, { expired: true });
    await seedExecutionContract(orgId, { state: 'signed', delivery: expired });
    const bare = await seedDelivery(orgId);
    const drafted = await seedDelivery(orgId);
    await seedExecutionContract(orgId, { state: 'draft', delivery: drafted });
    for (const hash of [atBoq.tokenHash, expired.tokenHash, bare.tokenHash, drafted.tokenHash, hashShareToken('nope'), null]) {
      expect(await readSql(hash)).toBeNull();
    }
    expect(await getDeliveryExecutionByToken(atBoq.rawToken)).toBeNull();
    expect(await getDeliveryExecutionByToken('  ')).toBeNull();
  });

  it('prefers the live contract to a terminated one, and shows a terminated one alone', async () => {
    const delivery = await seedDelivery(orgId);
    const ended = await seedExecutionContract(orgId, { state: 'signed', delivery });
    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [ended.contractId]);
    expect((await getDeliveryExecutionByToken(delivery.rawToken))?.contract).toMatchObject({ status: 'terminated' });
    const live = await seedExecutionContract(orgId, { state: 'signed', delivery });
    const card = await getDeliveryExecutionByToken(delivery.rawToken);
    expect(card?.contract).toMatchObject({ status: 'signed', documentNumber: expect.stringContaining(String(live.contractNumber).padStart(4, '0')) });
  });

  it('neither its output nor any body of the four functions names a price-basis word', async () => {
    const { delivery, contract } = await seedExecutionDelivery(orgId);
    const requestId = await seedRequest(orgId, contract.contractId, members.owner, { milestoneId: contract.milestoneIds[0] }, '62000');
    await seedPayment(orgId, contract.contractId, requestId, members.owner, '1000');
    const output = await readSql(delivery.tokenHash);
    expect(output).not.toBeNull();
    expect(FORBIDDEN.test(JSON.stringify(output))).toBe(false);
    const sources = await ownerQuery<{ proname: string; prosrc: string }>(
      `select proname, prosrc from pg_proc where proname in
         ('app_delivery_execution_by_token', 'app_delivery_claim_request_by_token',
          'app_delivery_execution_contract', 'app_studio_payment_details')`,
    );
    expect(sources).toHaveLength(4);
    for (const source of sources) expect({ fn: source.proname, forbidden: FORBIDDEN.test(source.prosrc) }).toEqual({ fn: source.proname, forbidden: false });
  });
});

describe('the card: requests with what is paid and due, receipts, both capped at 60', () => {
  let seeded: ExecutionDelivery;
  let requestId: string;

  beforeAll(async () => {
    seeded = await seedExecutionDelivery(orgId);
    requestId = await seedRequest(orgId, seeded.contract.contractId, members.owner, { milestoneId: seeded.contract.milestoneIds[0] }, '62000');
    await seedPayment(orgId, seeded.contract.contractId, requestId, members.owner, '2000.5');
  });

  it('shapes the request and the receipt for the browser', async () => {
    const card = await getDeliveryExecutionByToken(seeded.delivery.rawToken);
    expect(card?.contract).toMatchObject({ status: 'signed', originalValue: '124000.0000', titleEn: 'Execution contract' });
    expect(card?.requests).toEqual([
      expect.objectContaining({
        id: requestId,
        target: { kind: 'milestone', labelAr: null, labelEn: 'Advance' },
        amount: '62000.0000',
        paid: '2000.5000',
        outstanding: '59999.5000',
        void: false,
        claimedAt: null,
      }),
    ]);
    expect(card?.receipts).toEqual([expect.objectContaining({ amount: '2000.5000', requestNumber: card!.requests[0].documentNumber })]);
  });

  it('carries the newest 60 requests and 60 receipts, and says there are more', async () => {
    const many = await seedExecutionDelivery(orgId);
    for (let n = 0; n < 61; n += 1) {
      const variation = await seedVariation(orgId, many.contract, 'approved', { netDelta: '100' });
      const id = await seedRequest(orgId, many.contract.contractId, members.owner, { variationOrderId: variation.id }, '100');
      await seedPayment(orgId, many.contract.contractId, id, members.owner, '1');
    }
    const raw = await readSql(many.delivery.tokenHash);
    expect((raw!.requests as unknown[]).length).toBe(60);
    expect((raw!.receipts as unknown[]).length).toBe(60);
    expect(raw).toMatchObject({ requests_truncated: true, receipts_truncated: true });
    const numbers = (raw!.requests as Array<{ number: number }>).map((row) => row.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });
});

describe('the client\'s "I paid" (AC33, AC34)', () => {
  it('claims what is still due, with no amount from the client, and tells owner, admin and accountant only', async () => {
    const { delivery, contract } = await seedExecutionDelivery(orgId);
    const requestId = await seedRequest(orgId, contract.contractId, members.owner, { milestoneId: contract.milestoneIds[1] }, '37200');
    await seedPayment(orgId, contract.contractId, requestId, members.owner, '200');
    const [signature] = await ownerQuery<{ args: string }>(
      `select pg_get_function_arguments('public.app_delivery_claim_request_by_token(text, uuid, text, text, text, text)'::regprocedure) as args`,
    );
    expect(signature.args).not.toMatch(/amount/);
    expect(await claimExecutionRequestByToken(delivery.rawToken, { requestId, ip: '10.0.0.1', userAgent: 'phone' })).toEqual({ ok: true, already: false });
    expect(await claimsOf(contract.contractId)).toEqual([
      expect.objectContaining({ request_id: requestId, claimed_amount: '37000.0000', status: 'pending', actor_ip: '10.0.0.1', actor_user_agent: 'phone' }),
    ]);
    const notified = await claimNotifications(contract.contractId);
    expect(notified.map((row) => row.recipient_user_id).sort()).toEqual([members.owner, members.admin, members.accountant].sort());
    const [request] = await ownerQuery<{ number: number; year: number }>(
      `select number, extract(year from issued_on)::int as year from public.payment_requests where id = $1`,
      [requestId],
    );
    for (const row of notified) expect(row.params).toEqual({ number: request.number, year: request.year });

    expect(await claimExecutionRequestByToken(delivery.rawToken, { requestId, ip: null, userAgent: null })).toEqual({ ok: true, already: true });
    expect(await claimsOf(contract.contractId)).toHaveLength(1);
    expect(await claimNotifications(contract.contractId)).toHaveLength(3);
    const card = await getDeliveryExecutionByToken(delivery.rawToken);
    expect(card?.requests[0].claimedAt).not.toBeNull();
  });

  it('two concurrent claims of one request land one claim (the pending-claim arbiter)', async () => {
    const { delivery, contract } = await seedExecutionDelivery(orgId);
    const requestId = await seedRequest(orgId, contract.contractId, members.owner, { milestoneId: contract.milestoneIds[0] });
    const codes = await Promise.all([claimBySql(delivery.tokenHash, requestId), claimBySql(delivery.tokenHash, requestId)]);
    expect(codes.sort()).toEqual(['already', 'ok']);
    expect(await claimsOf(contract.contractId)).toHaveLength(1);
  });

  it('caps what the caller sends: name 120, ip 45, user agent 512, note 2000', async () => {
    const { delivery, contract } = await seedExecutionDelivery(orgId);
    const requestId = await seedRequest(orgId, contract.contractId, members.owner, { milestoneId: contract.milestoneIds[0] });
    const code = await claimBySql(delivery.tokenHash, requestId, { name: `  ${'n'.repeat(200)}`, ip: 'i'.repeat(90), ua: 'u'.repeat(900), note: 'x'.repeat(3000) });
    expect(code).toBe('ok');
    const [claim] = await claimsOf(contract.contractId);
    expect([claim.actor_name?.length, claim.actor_ip?.length, claim.actor_user_agent?.length, claim.note?.length]).toEqual([120, 45, 512, 2000]);
  });

  it('answers uniform codes: invalid, expired, not_active, and wrong_state for a void, paid, foreign or missing request', async () => {
    const { delivery, contract } = await seedExecutionDelivery(orgId);
    const voided = await seedRequest(orgId, contract.contractId, members.owner, { milestoneId: contract.milestoneIds[0] });
    await ownerQuery(`update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2 where id = $1`, [voided, members.owner]);
    const paid = await seedRequest(orgId, contract.contractId, members.owner, { milestoneId: contract.milestoneIds[1] }, '300');
    await seedPayment(orgId, contract.contractId, paid, members.owner, '300');
    const elsewhere = await seedExecutionDelivery(orgId);
    const foreign = await seedRequest(orgId, elsewhere.contract.contractId, members.owner, { milestoneId: elsewhere.contract.milestoneIds[0] });
    for (const requestId of [voided, paid, foreign, null]) expect(await claimBySql(delivery.tokenHash, requestId)).toBe('wrong_state');
    expect(await claimBySql(hashShareToken('nope'), foreign)).toBe('invalid');
    const expired = await seedDelivery(orgId, { expired: true });
    expect(await claimBySql(expired.tokenHash, foreign)).toBe('expired');
    const atBoq = await seedDelivery(orgId, { state: 'boq' });
    expect(await claimBySql(atBoq.tokenHash, foreign)).toBe('not_active');
    expect(await claimBySql((await seedDelivery(orgId)).tokenHash, foreign)).toBe('not_active');
    expect(await claimsOf(contract.contractId)).toEqual([]);
    expect(await claimExecutionRequestByToken(delivery.rawToken, { requestId: 'not-a-uuid', ip: null, userAgent: null })).toEqual({ ok: false, error: 'wrong_state' });
  });

  it('answers busy for the 11th claim on one contract within an hour, dismissed ones counted', async () => {
    const { delivery, contract } = await seedExecutionDelivery(orgId);
    const requestId = await seedRequest(orgId, contract.contractId, members.owner, { milestoneId: contract.milestoneIds[0] });
    for (let n = 0; n < 10; n += 1) {
      expect(await claimBySql(delivery.tokenHash, requestId)).toBe('ok');
      const claims = await claimsOf(contract.contractId);
      await dismissBySql(claims[claims.length - 1].id, members.owner);
    }
    expect(await claimBySql(delivery.tokenHash, requestId)).toBe('busy');
    expect(await claimExecutionRequestByToken(delivery.rawToken, { requestId, ip: null, userAgent: null })).toEqual({ ok: false, error: 'busy' });
    await ownerQuery(`update public.contract_payment_claims set created_at = now() - interval '61 minutes' where contract_id = $1`, [contract.contractId]);
    expect(await claimBySql(delivery.tokenHash, requestId)).toBe('ok');
  });

  it('holds the ceiling under 12 concurrent claims on 12 requests of one contract: 10 land', async () => {
    const { delivery, contract } = await seedExecutionDelivery(orgId);
    const requestIds: string[] = [];
    for (let n = 0; n < 12; n += 1) {
      const variation = await seedVariation(orgId, contract, 'approved', { netDelta: '100' });
      requestIds.push(await seedRequest(orgId, contract.contractId, members.owner, { variationOrderId: variation.id }, '100'));
    }
    const codes = await Promise.all(requestIds.map((id) => claimBySql(delivery.tokenHash, id)));
    expect(codes.filter((code) => code === 'ok')).toHaveLength(10);
    expect(codes.filter((code) => code === 'busy')).toHaveLength(2);
    expect(await claimsOf(contract.contractId)).toHaveLength(10);
  });

  it('waits at most 4 s on a held request row (lock_timeout on the function)', async () => {
    const [config] = await ownerQuery<{ proconfig: string[] }>(
      `select proconfig from pg_proc where proname = 'app_delivery_claim_request_by_token'`,
    );
    expect(config.proconfig).toEqual(expect.arrayContaining(['lock_timeout=4s', 'search_path=""']));
  });
});

describe('how to pay, only while something is due and the studio has a usable method (AC35)', () => {
  it('is null with nothing requested, null with no usable method, there while due, null once paid or void', async () => {
    const { delivery, contract } = await seedExecutionDelivery(orgId);
    const setDetails = (instapay: string | null, holder: string | null) =>
      setStudioDetails(orgId, { instapay_address: instapay, bank_account_holder: holder });
    await setDetails('studio@instapay', null);
    expect((await readSql(delivery.tokenHash))!.payment_details).toBeNull();
    const requestId = await seedRequest(orgId, contract.contractId, members.owner, { milestoneId: contract.milestoneIds[0] }, '500');
    expect((await getDeliveryExecutionByToken(delivery.rawToken))?.paymentDetails).toMatchObject({ instapay: 'studio@instapay' });
    await setDetails(null, 'A holder alone');
    expect((await readSql(delivery.tokenHash))!.payment_details).toBeNull();
    await setDetails('studio@instapay', null);
    await seedPayment(orgId, contract.contractId, requestId, members.owner, '500');
    expect((await readSql(delivery.tokenHash))!.payment_details).toBeNull();
    const voided = await seedRequest(orgId, contract.contractId, members.owner, { milestoneId: contract.milestoneIds[1] }, '500');
    await ownerQuery(`update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2 where id = $1`, [voided, members.owner]);
    expect((await getDeliveryExecutionByToken(delivery.rawToken))?.paymentDetails).toBeNull();
    await setDetails(null, null);
  });
});
