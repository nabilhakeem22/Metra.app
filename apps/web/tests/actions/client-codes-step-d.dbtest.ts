import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { codesOf, requestCode, seedHome, setClientEmail, type Home } from './client-home-fixture';
import { seedDelivery } from './delivery-execution-fixture';
import { seedBillableContract } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery, seedRequest, seedVariation, tamper } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Client codes DB step D (0066 and rls/functions/75-client-home.sql):
//   * the home contract's section and line pages are bound to the contract
//     the client opened (H6-read security S1): a stale contract id is gone;
//   * the day's cap on one delivery counts the GUESSES made on its codes (50),
//     with a looser cap of its own on the codes themselves (30), so a link
//     holder who only asks for codes cannot spend the delivery's day (re-check
//     M1); the per-target, per-studio and platform caps are unchanged;
//   * the issue answer says when the platform's day reaches half its cap, so
//     the app can raise the alarm before anyone is refused;
//   * the partial index the purge of never-used codes reads.
// Every test has a studio of its own, and its codes are cleared after it.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let fillerOrgId: string;

beforeAll(async () => {
  fillerOrgId = (await seedOrg({ owners: 1 })).orgId;
  orgIds.push(fillerOrgId);
});

beforeEach(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
});

afterEach(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = any($1::uuid[])`, [[orgId, fillerOrgId]]);
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
       values ($1, $2, 'decide_variation', $3, $4, 'x', $4, $5,
               now() - make_interval(secs => $6::int) + interval '10 minutes', now() - make_interval(secs => $6::int))`,
      [orgId, home.delivery.id, `past-${String(index)}`, 'a'.repeat(64), code.attempts, code.ageSeconds],
    );
  }
}

/** The platform's codes of the last day, every studio's. */
async function platformCodesToday(): Promise<number> {
  const [{ n }] = await ownerQuery<{ n: number }>(
    `select count(*)::int as n from public.client_verification_codes where created_at > now() - interval '1 day'`,
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

describe('the delivery\'s day counts guesses, not codes (re-check M1)', () => {
  it('codes asked for and never guessed do not use up the day: a 13th code is still made', async () => {
    const home = await seedHome(orgId, 'signed');
    const orders: string[] = [];
    for (let index = 0; index < 13; index += 1) {
      orders.push((await seedVariation(orgId, home.contract, 'issued', { tokenHash: `${randomUUID()}-d-${String(index)}` })).id);
    }
    for (const order of orders) {
      expect((await requestCode(home.delivery.tokenHash, 'decide_variation', order)).answer.status).toBe('ok');
    }
    expect(await codesOf(home.delivery.id)).toHaveLength(13);
  });

  it('49 wrong tries in the day leave room for a new code', async () => {
    const home = await seedHome(orgId);
    await pastCodes(home, [...Array.from({ length: 9 }, () => ({ attempts: 5, ageSeconds: 7200 })), { attempts: 4, ageSeconds: 7200 }]);
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer.status).toBe('ok');
  });

  it('the 50th wrong try refuses a new code until the try that made 50 is a day old, not the oldest code', async () => {
    const home = await seedHome(orgId);
    await pastCodes(home, [
      { attempts: 0, ageSeconds: 3 * 3600 },
      { attempts: 0, ageSeconds: 3 * 3600 },
      ...Array.from({ length: 10 }, () => ({ attempts: 5, ageSeconds: 3600 })),
    ]);
    const answer = (await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer;
    expect(answer.status).toBe('too_many');
    expect(answer.retry_after_seconds).toBeGreaterThan(22.5 * 3600);
    expect(answer.retry_after_seconds).toBeLessThanOrEqual(23 * 3600);
    expect(await codesOf(home.delivery.id)).toHaveLength(12);
  });

  it('still refuses the studio\'s 26th code of the day: per-studio 25 is unchanged', async () => {
    const home = await seedHome(orgId);
    await pastCodes(home, Array.from({ length: 25 }, () => ({ attempts: 0, ageSeconds: 3600 })));
    const answer = (await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer;
    expect(answer.status).toBe('too_many');
    expect(answer.retry_after_seconds).toBeGreaterThan(22 * 3600);
  });
});

describe('the platform\'s half day (the alarm before the cap)', () => {
  it('answers platform_day_half false below 40 codes and true from the code that makes 40', async () => {
    const home = await seedHome(orgId);
    const other = await seedHome(orgId);
    await fillPlatform(38 - (await platformCodesToday()));
    const below = (await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer;
    expect(below).toMatchObject({ status: 'ok', platform_day_half: false });
    expect(await platformCodesToday()).toBe(39);
    const reached = (await requestCode(other.delivery.tokenHash, 'sign_contract', other.contract.contractId)).answer;
    expect(reached).toMatchObject({ status: 'ok', platform_day_half: true });
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
  it('is a valid partial index on created_at over the codes not consumed', async () => {
    const rows = await ownerQuery<{ valid: boolean; definition: string }>(
      `select i.indisvalid as valid, pg_get_indexdef(i.indexrelid) as definition
         from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname = 'client_verification_codes_unused_created_idx'`,
    );
    expect(rows).toEqual([
      {
        valid: true,
        definition:
          'CREATE INDEX client_verification_codes_unused_created_idx ON public.client_verification_codes USING btree (created_at) WHERE (consumed_at IS NULL)',
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
