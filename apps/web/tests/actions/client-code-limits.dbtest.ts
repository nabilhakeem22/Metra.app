import { createSql } from '@metra/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ageCodes, codesOf, requestCode, seedHome, signWithCode, type Home } from './client-home-fixture';
import { closeExecutionFixture, ownerQuery, sqlstate, tamper } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Client home DB step C, the H3 fix round on the code issue and check
// (rls/functions/75-client-home.sql):
//  - S1: no studio spends the platform's day: 25 codes a studio a day, counted
//    before the platform's 80;
//  - R1: no platform-wide lock is held while a row lock is waited for, so one
//    studio's held delivery row delays that studio's code only, and past the
//    4 s wait it answers `busy`, never 55P03;
//  - R5: a code that expired more than 90 days ago may be deleted, and each
//    issue removes at most 50 of them;
//  - S5: 15 wrong tries on one target in a day, over all its codes, refuse even
//    the right code, and no new code is sent for it.

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

class Released extends Error {}

/** A studio transaction holding a delivery row FOR UPDATE on its own connection until `release`. */
async function holdDeliveryRow(deliveryId: string, maxMs = 9000) {
  const holder = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
  let letGo: () => void = () => undefined;
  const decided = new Promise<void>((resolve) => {
    letGo = resolve;
    setTimeout(resolve, maxMs);
  });
  let locked: () => void = () => undefined;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const finished = holder
    .begin(async (tx) => {
      await tx.unsafe(`select 1 from public.design_engagements where id = $1 for update`, [deliveryId]);
      locked();
      await decided;
      throw new Released();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Released)) throw error;
    })
    .finally(() => holder.end());
  await isLocked;
  return {
    async release() {
      letGo();
      await finished;
    },
  };
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
    const hold = await holdDeliveryRow(held.delivery.id);
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
    const hold = await holdDeliveryRow(held.delivery.id);
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
});

describe('S5: 15 wrong tries on one target a day', () => {
  it('counts the tries over the target\'s codes: then even the right code is locked, and no new code is sent', async () => {
    const home = await seedHome(studioA);
    const target = home.contract.contractId;
    const left: Array<number | undefined> = [];
    for (const tries of [3, 5, 5, 2]) {
      const issued = await requestCode(home.delivery.tokenHash, 'sign_contract', target);
      expect(issued.answer.status).toBe('ok');
      const wrong = issued.code === '000000' ? '111111' : '000000';
      for (let attempt = 0; attempt < tries; attempt += 1) {
        const answer = await signWithCode(home.delivery.tokenHash, target, issued.challengeId, wrong);
        expect(answer.code).toBe('code_wrong');
        left.push(answer.attempts_left);
      }
      if (tries === 2) {
        expect(await signWithCode(home.delivery.tokenHash, target, issued.challengeId, issued.code)).toEqual({ code: 'code_locked' });
      }
      await ageCodes(home.delivery.id, 61);
    }
    expect(left).toEqual([4, 3, 2, 4, 3, 2, 1, 0, 4, 3, 2, 1, 0, 1, 0]);
    const refused = (await requestCode(home.delivery.tokenHash, 'sign_contract', target)).answer;
    expect(refused.status).toBe('too_many');
    expect(refused.retry_after_seconds).toBeGreaterThan(23 * 3600);
    const contract = await ownerQuery<{ status: string }>(`select status::text from public.contracts where id = $1`, [target]);
    expect(contract).toEqual([{ status: 'issued' }]);
  });
});
