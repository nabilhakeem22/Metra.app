import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ageCodes,
  claimRequestWithCode,
  codesOf,
  markUnsent,
  requestCode,
  seedHome,
  setClientEmail,
  signWithCode,
  type Home,
} from './client-home-fixture';
import { claimsOf, seedDelivery } from './delivery-execution-fixture';
import { seedBillableContract } from './execution-billing-fixture';
import { appQuery, closeExecutionFixture, ownerQuery, seedRequest, seedVariation, tamper } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Client codes DB step D (0066 and rls/functions/75-client-home.sql):
//   * the home contract's section and line pages are bound to the contract
//     the client opened (H6-read security S1): a stale contract id is gone;
//   * one delivery takes at most 10 codes a day, below its studio's 25, so a
//     link holder who only asks for codes cannot lock the studio's other
//     clients out (H5 security S1); the studio can reset one delivery's
//     codes, audited, owner or admin only (the re-check M1 answer);
//   * a code whose email was never sent is marked unsent: it authorises
//     nothing and counts toward no day limit, only its target's 60 s spacing
//     (H5 reliability R1);
//   * a code is checked by its target, against the target's NEWEST code (H5
//     functional F1);
//   * a refusal names its limit (R6); the half-platform alarm is said once, by
//     the 40th code (R2); the claim ceiling is too_many with its wait (R5);
//   * the partial index the purge of never-used (or never-sent) codes reads.
// Every test has a studio of its own, and its codes are cleared after it.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let adminId: string;
let pmId: string;
let fillerOrgId: string;

beforeAll(async () => {
  fillerOrgId = (await seedOrg({ owners: 1 })).orgId;
  orgIds.push(fillerOrgId);
});

beforeEach(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'project_manager' }] });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  [adminId, pmId] = seeded.memberIds;
  orgIds.push(orgId);
});

afterEach(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = any($1::uuid[])`, [orgIds]);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/**
 * Codes the delivery asked for earlier, written straight into the table
 * (every user trigger off): one per entry, each on a target of its own (so no
 * per-target limit is near), made `ageSeconds` ago with `attempts` wrong tries.
 */
async function pastCodes(home: Home, codes: Array<{ attempts: number; ageSeconds: number }>): Promise<void> {
  for (const [index, code] of codes.entries()) {
    await tamper(
      `insert into public.client_verification_codes
         (org_id, engagement_id, purpose, target_key, destination_hash, destination_hint, code_hash, attempts, expires_at, created_at)
       select de.org_id, de.id, 'decide_variation', $2, $3, 'x', $3, $4,
              now() - make_interval(secs => $5::int) + interval '10 minutes', now() - make_interval(secs => $5::int)
         from public.design_engagements de where de.id = $1`,
      [home.delivery.id, `past-${String(index)}`, 'a'.repeat(64), code.attempts, code.ageSeconds],
    );
  }
}

/** `count` codes the delivery asked for an hour ago, never guessed. */
const codesAnHourAgo = (home: Home, count: number) =>
  pastCodes(home, Array.from({ length: count }, () => ({ attempts: 0, ageSeconds: 3600 })));

/** The platform's codes of the last day that were sent, every studio's. */
async function platformCodesToday(): Promise<number> {
  const [{ n }] = await ownerQuery<{ n: number }>(
    `select count(*)::int as n from public.client_verification_codes
      where created_at > now() - interval '1 day' and result_ref is distinct from id`,
  );
  return n;
}

/** `count` codes of another studio, made an hour ago, toward the platform's day only. */
async function fillPlatform(count: number): Promise<void> {
  const filler = await seedHome(fillerOrgId);
  await tamper(
    `insert into public.client_verification_codes
       (org_id, engagement_id, purpose, target_key, destination_hash, destination_hint, code_hash, expires_at, created_at)
     select $1, $2, 'sign_contract', 'filler-' || g, $3, 'x', $3, now() - interval '1 hour' + interval '1 minute', now() - interval '1 hour'
       from generate_series(1, $4::int) g`,
    [fillerOrgId, filler.delivery.id, 'a'.repeat(64), count],
  );
}

/** The studio's reset of one delivery's codes, as `userId` of `org` asks for it (metra_app, in the org's context). */
async function resetCodes(org: string, userId: string, engagementId: string): Promise<{ voided: number } | null> {
  const [row] = await appQuery<{ answer: { voided: number } | null }>(org, userId, `select public.app_client_codes_reset($1::uuid) as answer`, [
    engagementId,
  ]);
  return row.answer;
}

describe('S1: one delivery takes at most 10 codes a day, below its studio\'s 25', () => {
  it('the 11th code of a delivery is refused as the delivery\'s day, with the wait of its oldest code', async () => {
    const home = await seedHome(orgId);
    await codesAnHourAgo(home, 10);
    const refused = (await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer;
    expect(refused).toMatchObject({ status: 'too_many', limit: 'delivery_day' });
    expect(refused.retry_after_seconds).toBeGreaterThan(23 * 3600 - 60);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(23 * 3600);
  });

  it('a link that never guesses leaves another delivery of the same studio able to get a code', async () => {
    const attacked = await seedHome(orgId);
    const orders: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      orders.push((await seedVariation(orgId, attacked.contract, 'issued', { tokenHash: `${randomUUID()}-s1-${String(index)}` })).id);
    }
    const answers = [];
    for (const order of orders) answers.push((await requestCode(attacked.delivery.tokenHash, 'decide_variation', order)).answer.status);
    expect(answers).toEqual([...Array.from({ length: 10 }, () => 'ok'), 'too_many']);
    expect((await codesOf(attacked.delivery.id)).every((code) => code.attempts === 0)).toBe(true);
    const neighbour = await seedHome(orgId);
    expect((await requestCode(neighbour.delivery.tokenHash, 'sign_contract', neighbour.contract.contractId)).answer.status).toBe('ok');
  });

  it('four links in four studios cannot close the platform: a fifth studio still gets its code', async () => {
    for (let studio = 0; studio < 4; studio += 1) {
      const seeded = await seedOrg({ owners: 1 });
      orgIds.push(seeded.orgId);
      const link = await seedHome(seeded.orgId);
      await codesAnHourAgo(link, 10);
      expect((await requestCode(link.delivery.tokenHash, 'sign_contract', link.contract.contractId)).answer).toMatchObject({
        status: 'too_many',
        limit: 'delivery_day',
      });
    }
    const fifth = await seedHome(orgId);
    expect((await requestCode(fifth.delivery.tokenHash, 'sign_contract', fifth.contract.contractId)).answer.status).toBe('ok');
  });

  it('still refuses the studio\'s 26th code of the day: per-studio 25 is unchanged', async () => {
    const homes = [await seedHome(orgId), await seedHome(orgId), await seedHome(orgId)];
    await codesAnHourAgo(homes[0], 10);
    await codesAnHourAgo(homes[1], 10);
    await codesAnHourAgo(homes[2], 5);
    const last = await seedHome(orgId);
    const answer = (await requestCode(last.delivery.tokenHash, 'sign_contract', last.contract.contractId)).answer;
    expect(answer).toMatchObject({ status: 'too_many', limit: 'studio_day' });
    expect(answer.retry_after_seconds).toBeGreaterThan(22 * 3600);
  });
});

describe('the studio resets a delivery\'s codes (H5 security S1, re-check M1)', () => {
  it('after a reset the client can get a code at once, and a code sent before it no longer works', async () => {
    const home = await seedHome(orgId);
    await codesAnHourAgo(home, 9);
    const before = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(before.answer.status).toBe('ok');
    await ageCodes(home.delivery.id, 61);
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer).toMatchObject({
      status: 'too_many',
      limit: 'delivery_day',
    });
    expect(await resetCodes(orgId, ownerId, home.delivery.id)).toMatchObject({ voided: 1 });
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, before.code)).toEqual({ code: 'code_unknown' });
    const after = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(after.answer.status).toBe('ok');
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, after.code)).toEqual({ code: 'ok' });
  });

  it('an admin may reset; a project manager, another studio, or no delivery answers null and changes nothing', async () => {
    const home = await seedHome(orgId);
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    expect(await resetCodes(orgId, pmId, home.delivery.id)).toBeNull();
    expect(await resetCodes(other.orgId, other.ownerIds[0], home.delivery.id)).toBeNull();
    expect(await resetCodes(orgId, ownerId, randomUUID())).toBeNull();
    const [untouched] = await ownerQuery<{ reset_at: string | null }>(
      `select client_codes_reset_at as reset_at from public.design_engagements where id = $1`,
      [home.delivery.id],
    );
    expect(untouched.reset_at).toBeNull();
    expect(await resetCodes(orgId, adminId, home.delivery.id)).toMatchObject({ voided: 0 });
  });

  it('a reset does not lift the studio\'s 25 or touch the delivery\'s updated_at', async () => {
    const homes = [await seedHome(orgId), await seedHome(orgId), await seedHome(orgId)];
    await codesAnHourAgo(homes[0], 10);
    await codesAnHourAgo(homes[1], 10);
    await codesAnHourAgo(homes[2], 5);
    const [{ updated_at: updatedBefore }] = await ownerQuery<{ updated_at: string }>(
      `select updated_at::text from public.design_engagements where id = $1`,
      [homes[0].delivery.id],
    );
    await resetCodes(orgId, ownerId, homes[0].delivery.id);
    expect((await requestCode(homes[0].delivery.tokenHash, 'sign_contract', homes[0].contract.contractId)).answer).toMatchObject({
      status: 'too_many',
      limit: 'studio_day',
    });
    const [{ updated_at: updatedAfter }] = await ownerQuery<{ updated_at: string }>(
      `select updated_at::text from public.design_engagements where id = $1`,
      [homes[0].delivery.id],
    );
    expect(updatedAfter).toBe(updatedBefore);
  });
});

describe('R1: a code whose email failed spends no day', () => {
  it('25 failed sends in a studio, then the studio can still get codes; each unsent code authorises nothing', async () => {
    const home = await seedHome(orgId, 'signed');
    const unsent: Array<{ requestId: string; code: string }> = [];
    for (let index = 0; index < 25; index += 1) {
      const order = await seedVariation(orgId, home.contract, 'approved');
      const requestId = await seedRequest(orgId, home.contract.contractId, ownerId, { variationOrderId: order.id }, '10');
      const sent = await requestCode(home.delivery.tokenHash, 'claim_request', requestId);
      expect(sent.answer.status).toBe('ok');
      expect(await markUnsent(home.delivery.tokenHash, sent.challengeId)).toBe('ok');
      unsent.push({ requestId, code: sent.code });
    }
    expect(await claimRequestWithCode(home.delivery.tokenHash, unsent[0].requestId, unsent[0].code)).toEqual({ code: 'code_unknown' });
    const order = await seedVariation(orgId, home.contract, 'approved');
    const next = await seedRequest(orgId, home.contract.contractId, ownerId, { variationOrderId: order.id }, '10');
    expect((await requestCode(home.delivery.tokenHash, 'claim_request', next)).answer.status).toBe('ok');
    const neighbour = await seedHome(orgId);
    expect((await requestCode(neighbour.delivery.tokenHash, 'sign_contract', neighbour.contract.contractId)).answer.status).toBe('ok');
    expect(await claimsOf(home.contract.contractId)).toEqual([]);
  });

  it('an unsent code keeps only its target\'s 60 s spacing; the mark refuses a tried, used or foreign code', async () => {
    const home = await seedHome(orgId);
    const sent = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(await markUnsent(home.delivery.tokenHash, sent.challengeId)).toBe('ok');
    expect(await markUnsent(home.delivery.tokenHash, sent.challengeId)).toBe('gone');
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer).toMatchObject({
      status: 'too_many',
      limit: 'target_spacing',
    });
    await ageCodes(home.delivery.id, 61);
    const again = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(again.answer.status).toBe('ok');
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, '000000' === again.code ? '111111' : '000000')).toMatchObject({
      code: 'code_wrong',
    });
    expect(await markUnsent(home.delivery.tokenHash, again.challengeId)).toBe('gone');
    const neighbour = await seedHome(orgId);
    expect(await markUnsent(neighbour.delivery.tokenHash, again.challengeId)).toBe('gone');
  });
});

describe('F1: a code is checked by its target, against the newest code', () => {
  it('the right code with no code id signs; a wrong target is unknown, before any try is spent', async () => {
    const home = await seedHome(orgId);
    const other = await seedHome(orgId);
    const sent = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId, { code: '424242' });
    expect(await signWithCode(home.delivery.tokenHash, other.contract.contractId, '424242')).toEqual({ code: 'wrong_target' });
    expect(await signWithCode(other.delivery.tokenHash, other.contract.contractId, '424242')).toEqual({ code: 'code_unknown' });
    expect((await codesOf(home.delivery.id))[0].attempts).toBe(0);
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, sent.code)).toEqual({ code: 'ok' });
  });

  it('THE RULE: an older code, typed after a newer one was sent, is wrong and spends a try of the newest; the newest still signs', async () => {
    const home = await seedHome(orgId);
    await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId, { code: '111111' });
    await ageCodes(home.delivery.id, 61);
    await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId, { code: '222222' });
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, '111111')).toEqual({ code: 'code_wrong', attempts_left: 4 });
    const [older, newer] = await codesOf(home.delivery.id);
    expect([older.attempts, newer.attempts]).toEqual([0, 1]);
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, '222222')).toEqual({ code: 'ok' });
  });
});

describe('R6: a refusal names the limit that fired', () => {
  it('target_spacing, target_hour, target_tries, platform_day', async () => {
    const home = await seedHome(orgId);
    const target = home.contract.contractId;
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer.status).toBe('ok');
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer.limit).toBe('target_spacing');
    for (let index = 0; index < 4; index += 1) {
      await ageCodes(home.delivery.id, 61);
      expect((await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer.status).toBe('ok');
    }
    await ageCodes(home.delivery.id, 61);
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer.limit).toBe('target_hour');

    const guessed = await seedHome(orgId);
    await tamper(
      `insert into public.client_verification_codes
         (org_id, engagement_id, purpose, target_key, destination_hash, destination_hint, code_hash, attempts, expires_at, created_at)
       select $1, $2, 'sign_contract', $3, $4, 'x', $4, 5, now() - interval '5 minutes' + interval '10 minutes', now() - interval '5 minutes'
         from generate_series(1, 3)`,
      [orgId, guessed.delivery.id, guessed.contract.contractId, 'a'.repeat(64)],
    );
    expect((await requestCode(guessed.delivery.tokenHash, 'sign_contract', guessed.contract.contractId)).answer.limit).toBe('target_tries');

    const open = await seedHome(orgId);
    await fillPlatform(80 - (await platformCodesToday()));
    expect((await requestCode(open.delivery.tokenHash, 'sign_contract', open.contract.contractId)).answer).toMatchObject({
      status: 'too_many',
      limit: 'platform_day',
    });
  });
});

describe('R2: the platform\'s half day (the alarm before the cap) is said once', () => {
  it('false at 39, true for the code that makes 40, false again at 41', async () => {
    const homes = [await seedHome(orgId), await seedHome(orgId), await seedHome(orgId)];
    await fillPlatform(38 - (await platformCodesToday()));
    const crossed = [];
    for (const home of homes) {
      crossed.push((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer.platform_day_half_crossed);
    }
    expect(crossed).toEqual([false, true, false]);
    expect(await platformCodesToday()).toBe(41);
  });
});

describe('R5: the claim ceiling is too_many with its wait, and the code stays unused', () => {
  it('10 claims on the contract in the hour: the 11th answers too_many claims_hour until the oldest is an hour old', async () => {
    const home = await seedHome(orgId, 'signed');
    const requestId = await seedRequest(orgId, home.contract.contractId, ownerId, { milestoneId: home.contract.milestoneIds[0] }, '100');
    await tamper(
      `insert into public.contract_payment_claims (org_id, contract_id, request_id, claimed_amount, status, resolved_at, resolved_by, created_at)
       select $1, $2, $3, 100, 'dismissed', now(), $4, now() - interval '20 minutes' from generate_series(1, 10)`,
      [orgId, home.contract.contractId, requestId, ownerId],
    );
    const sent = await requestCode(home.delivery.tokenHash, 'claim_request', requestId);
    const answer = await claimRequestWithCode(home.delivery.tokenHash, requestId, sent.code);
    expect(answer).toMatchObject({ code: 'too_many', limit: 'claims_hour' });
    expect(answer.retry_after_seconds).toBeGreaterThan(40 * 60 - 30);
    expect(answer.retry_after_seconds).toBeLessThanOrEqual(40 * 60);
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null, attempts: 0 });
  });
});

describe('the ok answer names the studio and the document, for the server\'s email only', () => {
  it('a payment request (PR), a change order (VO) and a design delivery (DE), each with the studio\'s two names', async () => {
    const home = await seedHome(orgId, 'signed');
    const requestId = await seedRequest(orgId, home.contract.contractId, ownerId, { milestoneId: home.contract.milestoneIds[0] }, '100');
    const [request] = await ownerQuery<{ number: number; year: number }>(
      `select number, extract(year from issued_on)::int as year from public.payment_requests where id = $1`,
      [requestId],
    );
    const order = await seedVariation(orgId, home.contract, 'issued', { tokenHash: `${randomUUID()}-named` });
    const [studio] = await ownerQuery<{ name_ar: string | null; name_en: string | null }>(
      `select name_ar, name_en from public.organizations where id = $1`,
      [orgId],
    );
    const [variation] = await ownerQuery<{ number: number; year: number }>(
      `select number, extract(year from created_at at time zone 'Africa/Cairo')::int as year from public.variation_orders where id = $1`,
      [order.id],
    );
    const forRequest = (await requestCode(home.delivery.tokenHash, 'claim_request', requestId)).answer;
    expect(forRequest).toMatchObject({ status: 'ok', studio, document: { prefix: 'PR', ...request } });
    const forOrder = (await requestCode(home.delivery.tokenHash, 'decide_variation', order.id)).answer;
    expect(forOrder).toMatchObject({ status: 'ok', studio, document: { prefix: 'VO', number: variation.number, year: variation.year } });

    const design = await seedDelivery(orgId, { state: 'design_proposal' });
    await ownerQuery(`update public.design_engagements set design_fee = 10000 where id = $1`, [design.id]);
    await ownerQuery(
      `insert into public.engagement_milestones (org_id, engagement_id, kind, basis, value) values ($1, $2, 'deposit', 'percent', 30)`,
      [orgId, design.id],
    );
    await setClientEmail(orgId, design.clientId, 'design.client@example.com');
    const [delivery] = await ownerQuery<{ number: number; year: number }>(
      `select number, extract(year from created_at at time zone 'Africa/Cairo')::int as year from public.design_engagements where id = $1`,
      [design.id],
    );
    const forDesign = (await requestCode(design.tokenHash, 'claim_design_payment', 'deposit')).answer;
    expect(forDesign).toMatchObject({ status: 'ok', studio, document: { prefix: 'DE', ...delivery } });
  });
});

describe('0066: the index the purge of never-used codes reads', () => {
  it('is a valid partial index on created_at over the codes not consumed, or never sent', async () => {
    const rows = await ownerQuery<{ valid: boolean; definition: string }>(
      `select i.indisvalid as valid, pg_get_indexdef(i.indexrelid) as definition
         from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname = 'client_verification_codes_unused_created_idx'`,
    );
    expect(rows).toEqual([
      {
        valid: true,
        definition:
          'CREATE INDEX client_verification_codes_unused_created_idx ON public.client_verification_codes USING btree (created_at) WHERE ((consumed_at IS NULL) OR (result_ref = id))',
      },
    ]);
  });
});

describe('the contract pages answer only for the contract the client opened (H6-read security S1)', () => {
  const sections = (hash: string, contractId: string) =>
    ownerQuery<{ page: unknown }>(`select public.app_home_contract_sections_by_token($1, $2::uuid, 0) as page`, [hash, contractId]);
  const lines = (hash: string, contractId: string, sectionId: string) =>
    ownerQuery<{ page: unknown }>(`select public.app_home_contract_section_lines_by_token($1, $2::uuid, $3::uuid, 0) as page`, [
      hash,
      contractId,
      sectionId,
    ]);

  it('after the studio replaced the contract, the old id answers gone on both pages and the new id reads the new contract', async () => {
    const home = await seedHome(orgId, 'issued');
    const opened = home.contract;
    expect((await sections(home.delivery.tokenHash, opened.contractId))[0].page).not.toBeNull();
    expect((await lines(home.delivery.tokenHash, opened.contractId, opened.sectionIds[0]))[0].page).not.toBeNull();

    await tamper(`update public.contracts set status = 'terminated' where id = $1`, [opened.contractId]);
    const replacement = await seedBillableContract(orgId, 'issued', home.delivery);
    expect((await sections(home.delivery.tokenHash, opened.contractId))[0].page).toBeNull();
    expect((await lines(home.delivery.tokenHash, opened.contractId, replacement.sectionIds[0]))[0].page).toBeNull();
    expect((await lines(home.delivery.tokenHash, opened.contractId, opened.sectionIds[0]))[0].page).toBeNull();
    expect((await sections(home.delivery.tokenHash, replacement.contractId))[0].page).not.toBeNull();
    expect((await lines(home.delivery.tokenHash, replacement.contractId, replacement.sectionIds[0]))[0].page).not.toBeNull();
  });

  it('an id that was never the home\'s answers gone; the unbound forms are dropped', async () => {
    const home = await seedHome(orgId, 'issued');
    const other = await seedHome(orgId, 'issued');
    expect((await sections(home.delivery.tokenHash, other.contract.contractId))[0].page).toBeNull();
    expect((await lines(home.delivery.tokenHash, randomUUID(), home.contract.sectionIds[0]))[0].page).toBeNull();
    const [retired] = await ownerQuery<{ sections: string | null; lines: string | null }>(
      `select to_regprocedure('public.app_home_contract_sections_by_token(text, integer)')::text as sections,
              to_regprocedure('public.app_home_contract_section_lines_by_token(text, uuid, integer)')::text as lines`,
    );
    expect(retired).toEqual({ sections: null, lines: null });
  });
});
