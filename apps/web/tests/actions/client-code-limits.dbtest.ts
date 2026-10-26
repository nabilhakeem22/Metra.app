import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ageCodes, codesOf, holdLock, requestCode, seedHome, signWithCode, type Home } from './client-home-fixture';
import { closeExecutionFixture, ownerQuery, sqlstate, tamper } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Client home DB step C, the H3 fix round on the code issue and check
// (rls/functions/75-client-home.sql):
//  - S1: no studio spends the platform's day: 25 codes a studio a day, counted
//    before the platform's 80;
//  - R1: no platform-wide lock is held while a row lock is waited for, so one
//    studio's held delivery row delays that studio's code only, and past the
//    4 s wait it answers `busy`, never 55P03;
//  - R5, round 2 L2: a code never used that expired more than 90 days ago may
//    be deleted, and each issue removes at most 50 of them; a used code is
//    evidence and stays;
//  - round 2 M1 (from S5): 15 wrong tries on one target in an hour, over all
//    its codes, refuse a NEW code for it until the hour has passed, with the
//    exact wait; a code already sent keeps its own five tries, so whoever
//    holds only the link cannot lock the client out of the code in the mail.

const orgIds: string[] = [];
let studioA: string;
let studioB: string;

beforeAll(async () => {
  studioA = (await seedOrg({ owners: 1 })).orgId;
  studioB = (await seedOrg({ owners: 1 })).orgId;
  orgIds.push(studioA, studioB);
});

afterEach(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = any($1::uuid[])`, [orgIds]);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const hash64 = 'a'.repeat(64);

/** `count` codes of `orgId` made `ageSql` ago on a delivery of its own, as if requested then. */
async function seedPastCodes(orgId: string, count: number, ageSql: string): Promise<Home> {
  const filler = await seedHome(orgId);
  await tamper(
    `insert into public.client_verification_codes
       (org_id, engagement_id, purpose, target_key, destination_hash, destination_hint, code_hash, created_at, expires_at)
     select $1, $2, 'sign_contract', 'past-' || g, $3, 'x', $3, now() - $4::interval, now() - $4::interval + interval '10 minutes'
       from generate_series(1, $5::int) g`,
    [orgId, filler.delivery.id, hash64, ageSql, count],
  );
  return filler;
}

/** The advisory locks granted right now: the code issue's are the only ones these tests take. */
const grantedAdvisoryLocks = async () =>
  (await ownerQuery<{ n: number }>(`select count(*)::int as n from pg_locks where locktype = 'advisory' and granted`))[0].n;

describe('S1: 25 codes a studio a day, before the platform\'s 80', () => {
  it('a studio at its cap is refused with its own wait; another studio still gets its code', async () => {
    await seedPastCodes(studioA, 25, '1 hour');
    const atCap = await seedHome(studioA);
    const refused = (await requestCode(atCap.delivery.tokenHash, 'sign_contract', atCap.contract.contractId)).answer;
    expect(refused.status).toBe('too_many');
    expect(refused.retry_after_seconds).toBeGreaterThan(23 * 3600 - 60);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(23 * 3600);
    expect(await codesOf(atCap.delivery.id)).toEqual([]);
    const other = await seedHome(studioB);
    expect((await requestCode(other.delivery.tokenHash, 'sign_contract', other.contract.contractId)).answer.status).toBe('ok');
  });
});

describe('R1: no platform lock held behind one studio\'s row', () => {
  it('while studio A\'s delivery is held, A\'s request waits holding no advisory lock, and B is answered within 100 ms', async () => {
    const held = await seedHome(studioA);
    const other = await seedHome(studioB);
    const hold = await holdLock(`select 1 from public.design_engagements where id = $1 for update`, [held.delivery.id]);
    const waiting = requestCode(held.delivery.tokenHash, 'sign_contract', held.contract.contractId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await grantedAdvisoryLocks()).toBe(0);
    const started = performance.now();
    const answer = (await requestCode(other.delivery.tokenHash, 'sign_contract', other.contract.contractId)).answer;
    const took = performance.now() - started;
    expect(answer.status).toBe('ok');
    expect(took).toBeLessThan(100);
    await hold.release();
    expect((await waiting).answer.status).toBe('ok');
  });

  it('held past the 4 s wait: busy as an answer, never 55P03, and no row', async () => {
    const held = await seedHome(studioA);
    const hold = await holdLock(`select 1 from public.design_engagements where id = $1 for update`, [held.delivery.id]);
    const answer = (await requestCode(held.delivery.tokenHash, 'sign_contract', held.contract.contractId)).answer;
    await hold.release();
    expect(answer).toEqual({ status: 'busy' });
    expect(await codesOf(held.delivery.id)).toEqual([]);
  });
});

describe('R5: codes are purged 90 days after they expired', () => {
  it('a direct delete of such a code passes, of a fresh one is MT100; each issue removes at most 50', async () => {
    const old = await seedPastCodes(studioA, 61, '100 days');
    const [first] = await codesOf(old.delivery.id);
    expect(await sqlstate(ownerQuery(`delete from public.client_verification_codes where id = $1`, [first.id]))).toBeNull();
    const home = await seedHome(studioB);
    const fresh = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(fresh.answer.status).toBe('ok');
    expect(await codesOf(old.delivery.id)).toHaveLength(10);
    expect(await sqlstate(ownerQuery(`delete from public.client_verification_codes where id = $1`, [fresh.challengeId]))).toBe('MT100');
    await ageCodes(home.delivery.id, 61);
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer.status).toBe('ok');
    expect(await codesOf(old.delivery.id)).toEqual([]);
    expect(await codesOf(home.delivery.id)).toHaveLength(2);
  });

  it('round 2 L2: a USED code is evidence: 120 days past expiry it survives the purge and a direct delete, an unused one goes', async () => {
    const old = await seedPastCodes(studioA, 2, '120 days');
    const [used, unused] = await codesOf(old.delivery.id);
    await tamper(`update public.client_verification_codes set consumed_at = expires_at - interval '1 minute', result_ref = gen_random_uuid() where id = $1`, [used.id]);
    expect(await sqlstate(ownerQuery(`delete from public.client_verification_codes where id = $1`, [used.id]))).toBe('MT100');
    const home = await seedHome(studioB);
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId)).answer.status).toBe('ok');
    const left = await codesOf(old.delivery.id);
    expect(left.map((code) => code.id)).toEqual([used.id]);
    expect(left[0].consumed_at).not.toBeNull();
    expect(left.map((code) => code.id)).not.toContain(unused.id);
  });
});

/** `count` codes sent to sign the home's contract, 61 s apart: the first is the oldest. */
async function requestSignCodes(home: Home, count: number) {
  const issued = [];
  for (let index = 0; index < count; index += 1) {
    if (index > 0) await ageCodes(home.delivery.id, 61);
    const code = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(code.answer.status).toBe('ok');
    issued.push(code);
  }
  return issued;
}

/** Five wrong answers to one code, as a holder of the link alone can give: the tries left after each. */
async function spendFiveWrongTries(home: Home, code: { challengeId: string; code: string }) {
  const wrong = code.code === '000000' ? '111111' : '000000';
  const left: Array<number | undefined> = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    left.push((await signWithCode(home.delivery.tokenHash, home.contract.contractId, code.challengeId, wrong)).attempts_left);
  }
  return left;
}

describe('round 2 M1: 15 wrong tries on one target an hour refuse NEW codes only', () => {
  it('a link holder spends 15 tries over three codes: the client\'s right code from the 4th mail still signs', async () => {
    const home = await seedHome(studioA);
    const target = home.contract.contractId;
    const issued = await requestSignCodes(home, 4);
    for (const code of issued.slice(0, 3)) {
      expect(await spendFiveWrongTries(home, code)).toEqual([4, 3, 2, 1, 0]);
      expect(await signWithCode(home.delivery.tokenHash, target, code.challengeId, code.code)).toEqual({ code: 'code_locked' });
    }
    expect(await signWithCode(home.delivery.tokenHash, target, issued[3].challengeId, issued[3].code)).toEqual({ code: 'ok' });
    const contract = await ownerQuery<{ status: string }>(`select status::text from public.contracts where id = $1`, [target]);
    expect(contract).toEqual([{ status: 'signed' }]);
  });

  it('refuses a new code with the exact wait, then the hour reopens', async () => {
    const home = await seedHome(studioA);
    const target = home.contract.contractId;
    for (const code of await requestSignCodes(home, 4)) {
      expect(await spendFiveWrongTries(home, code)).toEqual([4, 3, 2, 1, 0]);
    }
    const refused = (await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer;
    expect(refused.status).toBe('too_many');
    // 20 tries over codes made 183, 122, 61 and 0 s ago: the oldest leaving the
    // hour still leaves 15, the second leaving it leaves 10, so the wait ends
    // when the code made 122 s ago is an hour old.
    expect(refused.retry_after_seconds).toBeGreaterThanOrEqual(3600 - 122 - 2);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(3600 - 122 + 1);
    await ageCodes(home.delivery.id, (refused.retry_after_seconds as number) - 3);
    const almost = (await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer;
    expect(almost.status).toBe('too_many');
    expect(almost.retry_after_seconds).toBeLessThanOrEqual(4);
    await ageCodes(home.delivery.id, 4);
    expect((await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer.status).toBe('ok');
  });
});
