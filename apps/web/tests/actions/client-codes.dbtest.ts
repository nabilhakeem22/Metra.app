import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type CodePurpose,
  ageCodes,
  claimDesignWithCode,
  claimRequestWithCode,
  codeHashOf,
  codesOf,
  decideWithCode,
  requestCode,
  seedHome,
  seedPrimaryContact,
  setClientEmail,
  signWithCode,
} from './client-home-fixture';
import { claimNotifications, claimsOf, seedDelivery } from './delivery-execution-fixture';
import { appQuery, closeExecutionFixture, ownerQuery, seedRequest, seedVariation, sqlstate, tamper } from './execution-fixture';
import { seedPayment } from './execution-billing-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Client home DB step C, the one-time codes (rls/functions/75-client-home.sql,
// policies/36-client-home.sql): the table's grants and guard, the issue
// function's checks and limits, and the four code-checked acts (AC4 to AC14 at
// the SQL level). Every call passes what the app will: sha256(purpose:target:
// code), never the code itself, and never a code id (the act checks the
// target's newest code, DB step D).
//
// Each test has a studio of its own, and its codes are cleared after it: the
// per-studio and platform day caps would otherwise carry one test's codes
// into the next.

const orgIds: string[] = [];
let orgId: string;
let otherOrgId: string;
let members: { owner: string; admin: string; pm: string; accountant: string };
let otherOwner: string;

beforeAll(async () => {
  const other = await seedOrg({ owners: 1 });
  otherOrgId = other.orgId;
  otherOwner = other.ownerIds[0];
  orgIds.push(otherOrgId);
});

beforeEach(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'project_manager' }, { role: 'accountant' }] });
  orgId = seeded.orgId;
  const [admin, pm, accountant] = seeded.memberIds;
  members = { owner: seeded.ownerIds[0], admin, pm, accountant };
  orgIds.push(orgId);
});

afterEach(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = any($1::uuid[])`, [[orgId, otherOrgId]]);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** A delivery still in design with a 30 % deposit on a 10,000 fee, the client's email on file. */
async function seedDesignDelivery() {
  const delivery = await seedDelivery(orgId, { state: 'design_proposal' });
  await ownerQuery(`update public.design_engagements set design_fee = 10000 where id = $1`, [delivery.id]);
  await ownerQuery(
    `insert into public.engagement_milestones (org_id, engagement_id, kind, basis, value) values ($1, $2, 'deposit', 'percent', 30)`,
    [orgId, delivery.id],
  );
  await setClientEmail(orgId, delivery.clientId, 'design.client@example.com');
  return delivery;
}

const contractStatus = async (contractId: string) =>
  (await ownerQuery<{ status: string }>(`select status::text from public.contracts where id = $1`, [contractId]))[0].status;

const contractEvents = async (contractId: string) =>
  ownerQuery<{ id: string; kind: string; pdf_hash: string | null; actor_name: string | null }>(
    `select id, kind::text, pdf_hash, actor_name from public.contract_events where contract_id = $1 order by decided_at, id`,
    [contractId],
  );

describe('client_verification_codes: read-only for the studio, guarded, isolated (AC4, AC5)', () => {
  it('denies metra_app every write, and code_hash even to read; reads every other column of its own org', async () => {
    const home = await seedHome(orgId);
    const issued = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(issued.answer.status).toBe('ok');
    const read = await appQuery<{ id: string; purpose: string; destination_hint: string }>(
      orgId,
      members.owner,
      `select id, purpose, destination_hint from public.client_verification_codes where engagement_id = $1`,
      [home.delivery.id],
    );
    expect(read).toEqual([{ id: issued.challengeId, purpose: 'sign_contract', destination_hint: 'c•••@e•••.com' }]);
    for (const statement of [
      `select code_hash from public.client_verification_codes`,
      `select * from public.client_verification_codes`,
      `update public.client_verification_codes set attempts = attempts + 1 where id = '${issued.challengeId}'`,
      `delete from public.client_verification_codes where id = '${issued.challengeId}'`,
      `insert into public.client_verification_codes (org_id, engagement_id, purpose, target_key, destination_hash, destination_hint, code_hash, expires_at)
       values ('${orgId}', '${home.delivery.id}', 'sign_contract', 'x', '${'a'.repeat(64)}', 'x', '${'a'.repeat(64)}', now() + interval '1 minute')`,
    ]) {
      expect({ statement, state: await sqlstate(appQuery(orgId, members.owner, statement)) }).toEqual({ statement, state: '42501' });
    }
    const theirs = await appQuery<{ n: number }>(
      otherOrgId,
      otherOwner,
      `select count(*)::int as n from public.client_verification_codes where engagement_id = $1`,
      [home.delivery.id],
    );
    expect(theirs).toEqual([{ n: 0 }]);
  });

  it('admits one wrong try at a time and one consumption only; refuses every other change and a direct delete (MT100)', async () => {
    const home = await seedHome(orgId);
    const { challengeId } = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    const update = (set: string) => ownerQuery(`update public.client_verification_codes set ${set} where id = $1`, [challengeId]);
    expect(await sqlstate(update(`attempts = attempts + 2`))).toBe('MT100');
    expect(await sqlstate(update(`code_hash = '${'b'.repeat(64)}'`))).toBe('MT100');
    expect(await sqlstate(update(`target_key = 'another'`))).toBe('MT100');
    expect(await sqlstate(update(`expires_at = expires_at + interval '1 second'`))).toBe('MT100');
    expect(await sqlstate(update(`attempts = attempts + 1, consumed_at = now(), result_ref = gen_random_uuid()`))).toBe('MT100');
    expect(await sqlstate(update(`attempts = attempts + 1`))).toBeNull();
    expect(await sqlstate(update(`consumed_at = now(), result_ref = gen_random_uuid()`))).toBeNull();
    expect(await sqlstate(update(`consumed_at = now(), result_ref = gen_random_uuid()`))).toBe('MT100');
    expect(await sqlstate(update(`attempts = attempts + 1`))).toBe('MT100');
    expect(await sqlstate(ownerQuery(`delete from public.client_verification_codes where id = $1`, [challengeId]))).toBe('MT100');
  });

  it('a consumption naming no row is the guard\'s MT100, before the consumed_pair CHECK (round 2 functional L1)', async () => {
    const home = await seedHome(orgId);
    const { challengeId } = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(await sqlstate(ownerQuery(`select public.app_client_code_consume($1, null)`, [challengeId]))).toBe('MT100');
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null, result_ref: null });
  });

  it('goes with its delivery: the cascade of a delivery delete is admitted', async () => {
    const delivery = await seedDesignDelivery();
    expect((await requestCode(delivery.tokenHash, 'claim_design_payment', 'deposit')).answer.status).toBe('ok');
    await ownerQuery(`delete from public.engagement_milestones where engagement_id = $1`, [delivery.id]);
    expect(await sqlstate(ownerQuery(`delete from public.design_engagements where id = $1`, [delivery.id]))).toBeNull();
    expect(await codesOf(delivery.id)).toEqual([]);
  });
});

describe('app_home_code_issue_by_token: what it checks before it makes a code (AC7, AC9)', () => {
  it('stores the hash only, the destination hash and hint, ip and user agent capped', async () => {
    const home = await seedHome(orgId);
    const issued = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId, {
      ip: '1'.repeat(60),
      ua: 'u'.repeat(600),
    });
    const [named] = await ownerQuery<{ studio: unknown; document: unknown }>(
      `select jsonb_build_object('name_ar', o.name_ar, 'name_en', o.name_en) as studio,
              jsonb_build_object('prefix', 'C', 'number', c.number,
                                 'year', extract(year from c.created_at at time zone 'Africa/Cairo')::int) as document
         from public.contracts c join public.organizations o on o.id = c.org_id where c.id = $1`,
      [home.contract.contractId],
    );
    expect(issued.answer).toEqual({
      status: 'ok',
      email: 'client.name@example.com',
      hint: 'c•••@e•••.com',
      resend_after_seconds: 60,
      platform_day_half_crossed: false,
      challenge_id: issued.challengeId,
      ...named,
    });
    const [stored] = await codesOf(home.delivery.id);
    expect(stored).toMatchObject({
      id: issued.challengeId,
      purpose: 'sign_contract',
      target_key: home.contract.contractId,
      code_hash: codeHashOf('sign_contract', home.contract.contractId, issued.code),
      destination_hint: 'c•••@e•••.com',
      attempts: 0,
      consumed_at: null,
      result_ref: null,
    });
    expect(stored.destination_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.actor_ip).toHaveLength(45);
    expect(stored.actor_user_agent).toHaveLength(512);
    const everything = JSON.stringify(await ownerQuery(`select * from public.client_verification_codes where id = $1`, [issued.challengeId]));
    expect(everything).not.toContain(issued.code);
  });

  it('sends to the primary contact before the client, and answers no_channel with no row when neither has an address', async () => {
    const home = await seedHome(orgId, 'issued', null);
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer).toEqual({ status: 'no_channel' });
    await setClientEmail(orgId, home.delivery.clientId, 'not-an-address');
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer).toEqual({ status: 'no_channel' });
    expect(await codesOf(home.delivery.id)).toEqual([]);
    await setClientEmail(orgId, home.delivery.clientId, 'owner@client.eg');
    await seedPrimaryContact(orgId, home.delivery.clientId, '  Primary@Contact.co.uk ');
    const answer = (await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer;
    expect(answer).toMatchObject({ status: 'ok', email: 'primary@contact.co.uk', hint: 'p•••@c•••.uk' });
  });

  it('answers not_available, with no row, for an act that cannot be taken now', async () => {
    const signed = await seedHome(orgId, 'signed');
    const owner = members.owner;
    const paid = await seedRequest(orgId, signed.contract.contractId, owner, { milestoneId: signed.contract.milestoneIds[0] }, '100');
    await seedPayment(orgId, signed.contract.contractId, paid, owner, '100');
    const otherHome = await seedHome(orgId, 'signed');
    const foreignOrder = await seedVariation(orgId, otherHome.contract, 'issued', { tokenHash: randomUUID().replace(/-/g, '') });
    const expiredOrder = await seedVariation(orgId, signed.contract, 'issued', { tokenHash: randomUUID().replace(/-/g, '') });
    await tamper(`update public.variation_orders set share_expires_at = now() - interval '1 day' where id = $1`, [expiredOrder.id]);
    const claimed = await seedRequest(orgId, signed.contract.contractId, owner, { milestoneId: signed.contract.milestoneIds[1] }, '100');
    await ownerQuery(
      `insert into public.contract_payment_claims (org_id, contract_id, request_id, claimed_amount) values ($1, $2, $3, 100)`,
      [orgId, signed.contract.contractId, claimed],
    );
    const cases: Array<[string, string]> = [
      ['sign_contract', signed.contract.contractId],
      ['claim_request', paid],
      ['claim_request', claimed],
      ['claim_request', randomUUID()],
      ['decide_variation', foreignOrder.id],
      ['decide_variation', expiredOrder.id],
      ['claim_design_payment', 'deposit'],
      ['unknown_purpose', signed.contract.contractId],
      ['sign_contract', 'x'.repeat(65)],
    ];
    for (const [purpose, target] of cases) {
      const { answer } = await requestCode(signed.delivery.tokenHash, purpose as CodePurpose, target);
      expect({ purpose, target, answer }).toEqual({ purpose, target, answer: { status: 'not_available' } });
    }
    const issued = await seedHome(orgId, 'issued');
    await tamper(`update public.contracts set share_expires_at = now() - interval '1 day' where id = $1`, [issued.contract.contractId]);
    expect((await requestCode(issued.delivery.tokenHash, 'sign_contract', issued.contract.contractId)).answer).toEqual({ status: 'not_available' });
    expect(await codesOf(signed.delivery.id)).toEqual([]);
    expect(await codesOf(issued.delivery.id)).toEqual([]);
  });

  it('answers invalid for an unknown or revoked link and expired for an expired one; refuses a malformed hash (22023)', async () => {
    const home = await seedHome(orgId);
    expect((await requestCode('f'.repeat(64), 'sign_contract', home.contract.contractId)).answer).toEqual({ status: 'invalid' });
    expect((await requestCode(null, 'sign_contract', home.contract.contractId)).answer).toEqual({ status: 'invalid' });
    await tamper(`update public.design_engagements set share_expires_at = now() - interval '1 minute' where id = $1`, [home.delivery.id]);
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer).toEqual({ status: 'expired' });
    const malformed = ownerQuery(`select public.app_home_code_issue_by_token($1, 'sign_contract', $2, 'ABC', null, null)`, [
      home.delivery.tokenHash,
      home.contract.contractId,
    ]);
    expect(await sqlstate(malformed)).toBe('22023');
  });
});

describe('app_home_code_issue_by_token: the limits, in the database (AC8)', () => {
  it('60 s between codes for one target, then 5 an hour for it', async () => {
    const home = await seedHome(orgId);
    const target = home.contract.contractId;
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer.status).toBe('ok');
    const second = (await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer;
    expect(second.status).toBe('too_many');
    expect(second.retry_after_seconds).toBeGreaterThan(0);
    expect(second.retry_after_seconds).toBeLessThanOrEqual(60);
    for (let issued = 2; issued <= 5; issued += 1) {
      await ageCodes(home.delivery.id, 61);
      expect((await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer.status).toBe('ok');
    }
    await ageCodes(home.delivery.id, 61);
    const sixth = (await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer;
    expect(sixth.status).toBe('too_many');
    expect(sixth.retry_after_seconds).toBeGreaterThan(60);
    expect(sixth.retry_after_seconds).toBeLessThanOrEqual(3600);
    expect(await codesOf(home.delivery.id)).toHaveLength(5);
  });

  it('80 a day across the platform', async () => {
    const home = await seedHome(orgId);
    const [{ n }] = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from public.client_verification_codes where created_at > now() - interval '1 day'`,
    );
    const filler = await seedHome(otherOrgId);
    await tamper(
      `insert into public.client_verification_codes
         (org_id, engagement_id, purpose, target_key, destination_hash, destination_hint, code_hash, expires_at, created_at)
       select $1, $2, 'sign_contract', 'filler-' || g, $3, 'x', $3, now() - interval '1 hour' + interval '1 minute', now() - interval '1 hour'
         from generate_series(1, $4::int) g`,
      [otherOrgId, filler.delivery.id, 'a'.repeat(64), 80 - n],
    );
    const answer = (await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer;
    expect(answer.status).toBe('too_many');
    expect(answer.retry_after_seconds).toBeGreaterThan(3600);
    await tamper(`delete from public.client_verification_codes where engagement_id = $1`, [filler.delivery.id]);
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer.status).toBe('ok');
  });
});

describe('the code check: wrong, locked, expired, unknown, used (AC10, AC11, AC12)', () => {
  it('counts wrong codes down 4 to 0, then refuses even the right one, and signs nothing', async () => {
    const home = await seedHome(orgId);
    const { code } = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    const wrong = code === '000000' ? '111111' : '000000';
    const left: Array<number | undefined> = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const answer = await signWithCode(home.delivery.tokenHash, home.contract.contractId, wrong);
      expect(answer.code).toBe('code_wrong');
      left.push(answer.attempts_left);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, code)).toEqual({ code: 'code_locked' });
    expect(await contractStatus(home.contract.contractId)).toBe('issued');
    expect(await contractEvents(home.contract.contractId)).toEqual([]);
  });

  it('expires after ten minutes; a code of another act, target or delivery is unknown', async () => {
    const home = await seedHome(orgId);
    const other = await seedHome(orgId);
    const forSign = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(await signWithCode(other.delivery.tokenHash, other.contract.contractId, forSign.code)).toEqual({ code: 'code_unknown' });
    await tamper(`update public.contracts set status = 'signed' where id = $1`, [home.contract.contractId]);
    const request = await seedRequest(orgId, home.contract.contractId, members.owner, { milestoneId: home.contract.milestoneIds[0] }, '100');
    expect(await claimRequestWithCode(home.delivery.tokenHash, request, forSign.code)).toEqual({ code: 'code_unknown' });
    await tamper(`update public.contracts set status = 'issued' where id = $1`, [home.contract.contractId]);
    await ageCodes(home.delivery.id, 601);
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, forSign.code)).toEqual({ code: 'code_expired' });
    // Only the newest code of a target is checked: once it has expired, any code typed for it is expired.
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, '123456')).toEqual({ code: 'code_expired' });
    expect(await contractEvents(home.contract.contractId)).toEqual([]);
  });

  it('signs once with the right code, consumes it by the event it wrote, and a replay writes nothing', async () => {
    const home = await seedHome(orgId);
    const { code } = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    const pdfHash = 'c'.repeat(64);
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, code, { pdfHash })).toEqual({ code: 'ok' });
    const events = await contractEvents(home.contract.contractId);
    expect(events).toEqual([{ id: events[0].id, kind: 'acknowledged', pdf_hash: pdfHash, actor_name: 'Client Name' }]);
    const [stored] = await codesOf(home.delivery.id);
    expect(stored.consumed_at).not.toBeNull();
    expect(stored.result_ref).toBe(events[0].id);
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, code)).toEqual({ code: 'code_used' });
    expect(await contractEvents(home.contract.contractId)).toHaveLength(1);
    const notified = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from public.notifications where entity_id = $1 and body_key = 'client_contract_signed'`,
      [home.contract.contractId],
    );
    expect(notified).toEqual([{ n: 3 }]);
  });

  it('refuses a contract that is not the home\'s before the code is checked, so a forged id costs no try', async () => {
    const home = await seedHome(orgId);
    const other = await seedHome(orgId);
    const { code } = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(await signWithCode(home.delivery.tokenHash, other.contract.contractId, code)).toEqual({ code: 'wrong_target' });
    expect((await codesOf(home.delivery.id))[0].attempts).toBe(0);
  });

  it('answers the signing window closing after the code was sent as signing_closed, and keeps the code', async () => {
    const home = await seedHome(orgId);
    const { code } = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    await tamper(`update public.contracts set share_expires_at = now() - interval '1 second' where id = $1`, [home.contract.contractId]);
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, code)).toEqual({ code: 'signing_closed' });
    expect((await codesOf(home.delivery.id))[0].consumed_at).toBeNull();
  });

  it('sets the verified flag for the inner call only: it reads off again in the same transaction', async () => {
    const home = await seedHome(orgId);
    const { code } = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    const [row] = await ownerQuery<{ answer: { code: string }; flag: string | null }>(
      `select public.app_home_contract_ack_by_token($1, $2::uuid, $3, 'Client', null, null, $4) as answer,
              current_setting('app.client_code_verified', true) as flag`,
      [home.delivery.tokenHash, home.contract.contractId, codeHashOf('sign_contract', home.contract.contractId, code), 'd'.repeat(64)],
    );
    expect(row).toEqual({ answer: { code: 'ok' }, flag: 'off' });
  });
});

describe('the other three acts with a code (AC13, AC21 at the SQL level)', () => {
  it('"I paid" on a request: one pending claim of the full outstanding, the studio told, the code consumed by the claim', async () => {
    const home = await seedHome(orgId, 'signed');
    const request = await seedRequest(orgId, home.contract.contractId, members.owner, { milestoneId: home.contract.milestoneIds[0] }, '62000');
    await seedPayment(orgId, home.contract.contractId, request, members.owner, '2000');
    const { code } = await requestCode(home.delivery.tokenHash, 'claim_request', request);
    expect(await claimRequestWithCode(home.delivery.tokenHash, request, code)).toEqual({ code: 'ok' });
    const claims = await claimsOf(home.contract.contractId);
    expect(claims.map((claim) => [claim.request_id, claim.claimed_amount, claim.status])).toEqual([[request, '60000.0000', 'pending']]);
    expect((await claimNotifications(home.contract.contractId)).map((row) => row.recipient_user_id).sort()).toEqual(
      [members.owner, members.admin, members.accountant].sort(),
    );
    expect((await codesOf(home.delivery.id))[0].result_ref).toBe(claims[0].id);
    expect(await claimRequestWithCode(home.delivery.tokenHash, request, code)).toEqual({ code: 'code_used' });
    const otherHome = await seedHome(orgId, 'signed');
    const foreign = await seedRequest(orgId, otherHome.contract.contractId, members.owner, {}, '10');
    expect(await claimRequestWithCode(home.delivery.tokenHash, foreign, code)).toEqual({ code: 'wrong_target' });
  });

  it('approve and reject a change order: the order flips, the studio is told, each needs its own code', async () => {
    const home = await seedHome(orgId, 'signed');
    const approveMe = await seedVariation(orgId, home.contract, 'issued', { tokenHash: randomUUID().replace(/-/g, '') + 'a' });
    const rejectMe = await seedVariation(orgId, home.contract, 'issued', { tokenHash: randomUUID().replace(/-/g, '') + 'b' });
    const approval = await requestCode(home.delivery.tokenHash, 'decide_variation', approveMe.id);
    expect(await decideWithCode(home.delivery.tokenHash, rejectMe.id, 'reject', approval.code)).toEqual({ code: 'code_unknown' });
    expect(await decideWithCode(home.delivery.tokenHash, approveMe.id, 'maybe', approval.code)).toEqual({ code: 'invalid' });
    expect(await decideWithCode(home.delivery.tokenHash, approveMe.id, 'approve', approval.code)).toEqual({ code: 'ok' });
    const rejection = await requestCode(home.delivery.tokenHash, 'decide_variation', rejectMe.id);
    expect(await decideWithCode(home.delivery.tokenHash, rejectMe.id, 'reject', rejection.code)).toEqual({ code: 'ok' });
    const statuses = await ownerQuery<{ id: string; status: string }>(
      `select id, status::text from public.variation_orders where id = any($1::uuid[]) order by number`,
      [[approveMe.id, rejectMe.id]],
    );
    expect(statuses).toEqual([
      { id: approveMe.id, status: 'approved' },
      { id: rejectMe.id, status: 'rejected' },
    ]);
    const bodies = await ownerQuery<{ body_key: string; n: number }>(
      `select body_key, count(*)::int as n from public.notifications where entity_id = $1 and body_key like 'client_variation_%' group by body_key order by body_key`,
      [home.contract.contractId],
    );
    expect(bodies).toEqual([
      { body_key: 'client_variation_approved', n: 3 },
      { body_key: 'client_variation_rejected', n: 3 },
    ]);
    const events = await ownerQuery<{ id: string; variation_order_id: string }>(
      `select id, variation_order_id from public.variation_order_events where variation_order_id = any($1::uuid[]) and kind in ('approved', 'rejected')`,
      [[approveMe.id, rejectMe.id]],
    );
    const refs = (await codesOf(home.delivery.id)).map((stored) => stored.result_ref).sort();
    expect(refs).toEqual(events.map((event) => event.id).sort());
  });

  it('"I paid" on a design instalment: one pending claim, the code consumed by it; then nothing more to claim', async () => {
    const delivery = await seedDesignDelivery();
    const { code } = await requestCode(delivery.tokenHash, 'claim_design_payment', 'deposit');
    expect(await claimDesignWithCode(delivery.tokenHash, 'deposit', code)).toEqual({ code: 'ok' });
    const claims = await ownerQuery<{ id: string; claimed_amount: string }>(
      `select id, claimed_amount::text from public.client_payment_claims where engagement_id = $1`,
      [delivery.id],
    );
    expect(claims.map((claim) => claim.claimed_amount)).toEqual(['3000.0000']);
    expect((await codesOf(delivery.id))[0].result_ref).toBe(claims[0].id);
    expect((await requestCode(delivery.tokenHash, 'claim_design_payment', 'deposit')).answer).toEqual({ status: 'not_available' });
    expect((await requestCode(delivery.tokenHash, 'claim_design_payment', 'gate_a')).answer).toEqual({ status: 'not_available' });
  });
});

describe('the raw code never reaches the database (AC14)', () => {
  it('no stored column and no function argument of the acts carries it: only its hash', async () => {
    const home = await seedHome(orgId);
    const issued = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    await signWithCode(home.delivery.tokenHash, home.contract.contractId, issued.code);
    const stored = JSON.stringify(await ownerQuery(`select * from public.client_verification_codes where engagement_id = $1`, [home.delivery.id]));
    expect(stored).toContain(codeHashOf('sign_contract', home.contract.contractId, issued.code));
    expect(stored).not.toMatch(new RegExp(`"${issued.code}"`));
    const signatures = await ownerQuery<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname like 'app_home_%_by_token'`,
    );
    for (const { args } of signatures) expect(args).not.toMatch(/\bp_code\b/);
  });
});
