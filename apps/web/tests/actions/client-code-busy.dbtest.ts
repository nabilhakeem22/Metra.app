import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  claimDesignWithCode,
  claimRequestWithCode,
  codesOf,
  decideWithCode,
  holdLock,
  requestCode,
  seedHome,
  setClientEmail,
  signWithCode,
  type ActAnswer,
  type RequestedCode,
} from './client-home-fixture';
import { seedDelivery } from './delivery-execution-fixture';
import { closeExecutionFixture, ownerQuery, seedRequest, seedVariation, tamper } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Client home DB step C, round 2 (secrel L3, functional L2): a code act that
// waits out its 4 s on a lock a studio write holds answers `{code: 'busy'}`,
// never 55P03, and leaves its code as it found it: not consumed, no try spent,
// so the same code works once the studio's write is done. Every lock the act
// can wait on is held in turn: the act's own row (contract, change order,
// payment request, delivery), the code's row, and the per-target lock.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
});

afterEach(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = $1`, [orgId]);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/**
 * Hold `lockSql` (with 6 s of margin over the act's 4 s wait), run the act with
 * the code, release, and answer what the act said, the code's row right after,
 * and what the same code answers once the lock is gone.
 */
async function actWhileHeld(lockSql: string, params: unknown[], code: RequestedCode, act: () => Promise<ActAnswer>) {
  const hold = await holdLock(lockSql, params, 6000);
  const held = await act();
  await hold.release();
  const [row] = await ownerQuery<{ attempts: number; consumed: boolean }>(
    `select attempts, consumed_at is not null as consumed from public.client_verification_codes where id = $1`,
    [code.challengeId],
  );
  return { held, row, after: await act() };
}

const UNTOUCHED = { attempts: 0, consumed: false };

describe('an act that waits out its 4 s on a studio lock answers busy', () => {
  it('signing, while the contract row is held', async () => {
    const home = await seedHome(orgId, 'issued');
    const code = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    const sign = () => signWithCode(home.delivery.tokenHash, home.contract.contractId, code.code);
    const result = await actWhileHeld(`select 1 from public.contracts where id = $1 for update`, [home.contract.contractId], code, sign);
    expect(result).toEqual({ held: { code: 'busy' }, row: UNTOUCHED, after: { code: 'ok' } });
  });

  it('deciding a change order, while its row is held', async () => {
    const home = await seedHome(orgId, 'signed');
    const order = await seedVariation(orgId, home.contract, 'issued', { tokenHash: `${randomUUID()}-busy` });
    const code = await requestCode(home.delivery.tokenHash, 'decide_variation', order.id);
    const decide = () => decideWithCode(home.delivery.tokenHash, order.id, 'approve', code.code);
    const result = await actWhileHeld(`select 1 from public.variation_orders where id = $1 for update`, [order.id], code, decide);
    expect(result).toEqual({ held: { code: 'busy' }, row: UNTOUCHED, after: { code: 'ok' } });
  });

  it('"I paid" on a request, while the studio holds the payment request row for 6 s', async () => {
    const home = await seedHome(orgId, 'signed');
    const request = await seedRequest(orgId, home.contract.contractId, ownerId, { milestoneId: home.contract.milestoneIds[0] }, '1000');
    const code = await requestCode(home.delivery.tokenHash, 'claim_request', request);
    const claim = () => claimRequestWithCode(home.delivery.tokenHash, request, code.code);
    const result = await actWhileHeld(`select 1 from public.payment_requests where id = $1 for update`, [request], code, claim);
    expect(result).toEqual({ held: { code: 'busy' }, row: UNTOUCHED, after: { code: 'ok' } });
  });

  it('"I paid" on a design instalment, while the delivery row is held', async () => {
    const delivery = await seedDelivery(orgId, { state: 'design_proposal' });
    await ownerQuery(`update public.design_engagements set design_fee = 10000 where id = $1`, [delivery.id]);
    await ownerQuery(
      `insert into public.engagement_milestones (org_id, engagement_id, kind, basis, value) values ($1, $2, 'deposit', 'percent', 30)`,
      [orgId, delivery.id],
    );
    await setClientEmail(orgId, delivery.clientId, 'design.client@example.com');
    const code = await requestCode(delivery.tokenHash, 'claim_design_payment', 'deposit');
    const claim = () => claimDesignWithCode(delivery.tokenHash, 'deposit', code.code);
    const result = await actWhileHeld(`select 1 from public.design_engagements where id = $1 for update`, [delivery.id], code, claim);
    expect(result).toEqual({ held: { code: 'busy' }, row: UNTOUCHED, after: { code: 'ok' } });
  });

  it('any act, while its code row is held', async () => {
    const home = await seedHome(orgId, 'issued');
    const code = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    const sign = () => signWithCode(home.delivery.tokenHash, home.contract.contractId, code.code);
    const result = await actWhileHeld(`select 1 from public.client_verification_codes where id = $1 for update`, [code.challengeId], code, sign);
    expect(result).toEqual({ held: { code: 'busy' }, row: UNTOUCHED, after: { code: 'ok' } });
  });

  it('any act, while another act on the same target holds the per-target lock; a wrong code then costs no try', async () => {
    const home = await seedHome(orgId, 'issued');
    const code = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    const wrong = code.code === '000000' ? '111111' : '000000';
    const signWrong = () => signWithCode(home.delivery.tokenHash, home.contract.contractId, wrong);
    const targetLock = `select pg_advisory_xact_lock(hashtextextended(concat_ws(':', 'client-code-target', $1::uuid, 'sign_contract', $2::text), 0))`;
    const result = await actWhileHeld(targetLock, [home.delivery.id, home.contract.contractId], code, signWrong);
    expect(result).toEqual({ held: { code: 'busy' }, row: UNTOUCHED, after: { code: 'code_wrong', attempts_left: 4 } });
    expect(await codesOf(home.delivery.id)).toHaveLength(1);
  });
});

// H5 reliability R3 (client codes DB step D): a table held by DDL (an apply-rls
// policy file, a migration: ACCESS EXCLUSIVE) is met at the wrapper's FIRST
// table read, before any row lock, and that wait answers `busy` too: no 55P03
// escapes from any code wrapper, and nothing is written. Each table the
// reliability tester held, in turn, against the code request and "I paid"
// (both read every one of them), and against signing, deciding and the design
// claim, whose first read is the delivery's own table.
describe('R3: a table held by DDL answers busy from the first table read, never 55P03', () => {
  /** Run `acts` while `table` is held ACCESS EXCLUSIVE; what each answered, or the SQLSTATE it threw. */
  async function whileTableHeld(table: string, acts: Record<string, () => Promise<{ status?: string; code?: string }>>) {
    const hold = await holdLock(`lock table public.${table} in access exclusive mode`, [], 12_000);
    const answered = await Promise.all(
      Object.entries(acts).map(async ([name, act]) => {
        try {
          const answer = await act();
          return [name, answer.status ?? answer.code] as const;
        } catch (error) {
          return [name, `threw ${String((error as { code?: unknown }).code)}`] as const;
        }
      }),
    );
    await hold.release();
    return Object.fromEntries(answered);
  }

  it.each(['client_verification_codes', 'design_engagements', 'payment_requests', 'contract_payment_claims', 'organizations'])(
    'the code request and "I paid" while %s is held',
    async (table) => {
      const home = await seedHome(orgId, 'signed');
      const request = await seedRequest(orgId, home.contract.contractId, ownerId, { milestoneId: home.contract.milestoneIds[0] }, '1000');
      const code = await requestCode(home.delivery.tokenHash, 'claim_request', request);
      await tamper(`update public.client_verification_codes set created_at = created_at - interval '61 seconds', expires_at = expires_at - interval '61 seconds' where id = $1`, [
        code.challengeId,
      ]);
      const answers = await whileTableHeld(table, {
        request: async () => (await requestCode(home.delivery.tokenHash, 'claim_request', request)).answer,
        claim: () => claimRequestWithCode(home.delivery.tokenHash, request, code.code),
      });
      expect(answers).toEqual({ request: 'busy', claim: 'busy' });
      expect(await codesOf(home.delivery.id)).toEqual([expect.objectContaining({ attempts: 0, consumed_at: null })]);
      expect(await claimRequestWithCode(home.delivery.tokenHash, request, code.code)).toEqual({ code: 'ok' });
    },
  );

  it('signing, deciding and the design claim while the delivery table is held', async () => {
    const home = await seedHome(orgId, 'issued');
    const order = await seedVariation(orgId, home.contract, 'issued', { tokenHash: `${randomUUID()}-ddl` });
    const delivery = await seedDelivery(orgId, { state: 'design_proposal' });
    const answers = await whileTableHeld('design_engagements', {
      sign: () => signWithCode(home.delivery.tokenHash, home.contract.contractId, '123456'),
      decide: () => decideWithCode(home.delivery.tokenHash, order.id, 'approve', '123456'),
      design: () => claimDesignWithCode(delivery.tokenHash, 'deposit', '123456'),
    });
    expect(answers).toEqual({ sign: 'busy', decide: 'busy', design: 'busy' });
  });
});
