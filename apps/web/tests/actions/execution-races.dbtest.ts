import { createSql } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeExecutionFixture,
  ownerQuery,
  seedExecutionContract,
  seedRequest,
  type ExecutionContract,
} from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// A2 reliability R1 and R2, the testers' races, as metra_app with the app's
// preamble and NO app-side lock: the DATABASE alone must keep the invariants.
//   R1: a schedule row never commits into a contract an issue has already
//       changed (enforce_contract_child_draft reads the parent FOR SHARE).
//   R2: no payment on a void request, no void of a paid request, never more
//       paid than requested (enforce_contract_payment_fits on insert, MT130 /
//       MT131; enforce_payment_request_frozen on void, MT132).

const RUNS_SCHEDULE = 10;
const RUNS_MONEY = 20;
const sessions = Array.from({ length: 4 }, () =>
  createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false }),
);
type Session = (typeof sessions)[number];

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
});

afterAll(async () => {
  for (const session of sessions) await session.end();
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** One app-shaped transaction on its own connection: role, org context, lock_timeout. */
function asApp<T>(session: Session, work: (tx: Session) => Promise<T>): Promise<T> {
  return session.begin(async (tx) => {
    await tx`select set_config('app.current_org_id', ${orgId}, true),
                    set_config('app.current_user_id', ${ownerId}, true),
                    set_config('lock_timeout', '5s', true)`;
    await tx.unsafe('set local role metra_app');
    return work(tx as unknown as Session);
  }) as Promise<T>;
}

/** The SQLSTATE a refused race leg ended with, or its own outcome label. */
async function outcome(leg: Promise<string>): Promise<string> {
  try {
    return await leg;
  } catch (error) {
    return (error as { code?: string }).code ?? 'error';
  }
}

/** A promise settled from outside: the handshake between two legs of a race. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (reason: unknown) => void } {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface IssueRun {
  /** Settles with 'issued', or the SQLSTATE the issue was refused with. */
  result: Promise<string>;
  /** Resolves once the status UPDATE has returned (the contract row is then changed and locked). */
  updated: Promise<void>;
  /** The schedule sum the gate read; valid once `result` has settled. */
  gate: { sum: number };
}

/**
 * The issue gate as the real issue core is built: lock the contract row FOR
 * UPDATE FIRST, then read the schedule, then flip the status, all in one
 * transaction. (Reading before locking leaves a window the trigger can only
 * close after the UPDATE: a schedule row committed in it is never seen by the gate.)
 */
function issueContract(session: Session, contractId: string, holdMs: number): IssueRun {
  const gate = { sum: Number.NaN };
  const updated = deferred();
  const result = outcome(
    asApp(session, async (tx) => {
      await tx.unsafe(`select 1 from public.contracts where id = $1 for update`, [contractId]);
      const [sum] = await tx.unsafe(
        `select coalesce(sum(value), 0) as s from public.contract_payment_milestones where contract_id = $1`,
        [contractId],
      );
      gate.sum = Number(sum.s);
      await tx.unsafe(
        `update public.contracts set status = 'issued', token_hash = $2,
                share_expires_at = now() + interval '30 days', updated_at = now()
          where id = $1 and status = 'draft'`,
        [contractId, `race-${contractId}`],
      );
      updated.resolve();
      await tx.unsafe('select pg_sleep($1)', [holdMs / 1000]);
      return 'issued';
    }),
  );
  void result.then(() => updated.reject(new Error('the issue ended before its UPDATE returned')));
  updated.promise.catch(() => undefined);
  return { result, updated: updated.promise, gate };
}

/** One editor insert of a 25% milestone into the contract's schedule, in its own transaction. */
function addMilestone(session: Session, contractId: string): Promise<string> {
  return outcome(
    asApp(session, async (tx) => {
      await tx.unsafe(
        `insert into public.contract_payment_milestones (org_id, contract_id, label_en, basis, value, sort_order)
         values ($1, $2, 'Late', 'percent', 25, 9)`,
        [orgId, contractId],
      );
      return 'added';
    }),
  );
}

const draftContract = (): Promise<ExecutionContract> =>
  seedExecutionContract(orgId, {
    state: 'draft',
    linesPerSection: [1],
    schedule: [{ labelEn: 'All', basis: 'percent', value: '100' }],
  });

async function finalState(contractId: string): Promise<{ status: string; sum: number }> {
  const [state] = await ownerQuery<{ status: string; s: string }>(
    `select c.status, (select coalesce(sum(value), 0) from public.contract_payment_milestones m where m.contract_id = c.id) as s
       from public.contracts c where c.id = $1`,
    [contractId],
  );
  return { status: state.status, sum: Number(state.s) };
}

describe('R1: the schedule freezes with its contract, against a concurrent issue', () => {
  // Every assertion here holds for EVERY interleaving; none depends on how long
  // either leg takes. The editor's start is staggered only to vary the overlap.
  const STAGGER_MS = [0, 1, 2, 4, 8, 16];

  it(`the issued schedule is the one the gate read, and a late row is accepted only if the gate saw it (${String(RUNS_SCHEDULE)} races)`, async () => {
    const tally: Record<string, number> = {};
    for (let run = 0; run < RUNS_SCHEDULE; run += 1) {
      const contract = await draftContract();
      const issue = issueContract(sessions[0], contract.contractId, 60);
      await pause(STAGGER_MS[run % STAGGER_MS.length]);
      const editor = addMilestone(sessions[1], contract.contractId);
      const [issued, added] = await Promise.all([issue.result, editor]);
      const state = await finalState(contract.contractId);
      const label = JSON.stringify({ run, issued, added, gate: issue.gate.sum, state, tally });
      tally[`${issued}/${added}`] = (tally[`${issued}/${added}`] ?? 0) + 1;

      expect(issued, label).toBe('issued');
      expect(state.status, label).toBe('issued');
      // The gate read either the schedule alone or the schedule with the late row.
      expect([100, 125], label).toContain(issue.gate.sum);
      // SAFETY: what is in the issued contract is exactly what the gate read.
      expect(state.sum, label).toBe(issue.gate.sum);
      // The late row is accepted only if the gate saw it; otherwise the database refused it.
      if (added === 'added') expect(issue.gate.sum, label).toBe(125);
      else expect([added, issue.gate.sum], label).toEqual(['MT100', 100]);
    }
  });

  it('an editor that runs after the issue UPDATE returned is refused (MT100), and the issued schedule is untouched', async () => {
    const contract = await draftContract();
    const issue = issueContract(sessions[0], contract.contractId, 300);
    await issue.updated;
    const added = await addMilestone(sessions[1], contract.contractId);
    expect(added).toBe('MT100');
    expect(await issue.result).toBe('issued');
    expect(issue.gate.sum).toBe(100);
    expect(await finalState(contract.contractId)).toEqual({ status: 'issued', sum: 100 });
  });

  it('an editor that committed before the issuer started is seen by the gate', async () => {
    const contract = await draftContract();
    expect(await addMilestone(sessions[1], contract.contractId)).toBe('added');
    const issue = issueContract(sessions[0], contract.contractId, 0);
    expect(await issue.result).toBe('issued');
    expect(issue.gate.sum).toBe(125);
    expect(await finalState(contract.contractId)).toEqual({ status: 'issued', sum: 125 });
  });
});

describe('R2: the payment invariant holds with no app lock at all', () => {
  // Each race gets its own signed contract and final-account request (one live
  // final account per contract), so no run sees another's payments.
  const contractOf = new Map<string, string>();
  async function freshRequest(amount: string): Promise<string> {
    const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [1] });
    const requestId = await seedRequest(orgId, contract.contractId, ownerId, {}, amount);
    contractOf.set(requestId, contract.contractId);
    return requestId;
  }

  function contractIdOf(requestId: string): string {
    const contractId = contractOf.get(requestId);
    if (!contractId) throw new Error(`no contract recorded for request ${requestId}`);
    return contractId;
  }

  const insertPayment = (tx: Session, requestId: string, amount: string, key: string | null = null) =>
    tx.unsafe(
      `insert into public.contract_payments
         (org_id, contract_id, request_id, amount, received_on, recorded_by, idempotency_key)
       values ($1, $2, $3, $4, current_date, $5, $6)
       on conflict (org_id, contract_id, idempotency_key) where idempotency_key is not null do nothing
       returning id`,
      [orgId, contractIdOf(requestId), requestId, amount, ownerId, key],
    );

  it(`void racing a payment: never a void request holding a payment (${String(RUNS_MONEY)} races)`, async () => {
    const tally: Record<string, number> = {};
    let corrupt = 0;
    for (let run = 0; run < RUNS_MONEY; run += 1) {
      const requestId = await freshRequest('1000');
      const voider = outcome(
        asApp(sessions[0], async (tx) => {
          const [paid] = await tx.unsafe(
            `select count(*)::int as n from public.contract_payments where request_id = $1`,
            [requestId],
          );
          await pause(30);
          if (Number(paid.n) > 0) return 'has_payments';
          const voided = await tx.unsafe(
            `update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2, updated_at = now()
              where id = $1 and status = 'issued' returning id`,
            [requestId, ownerId],
          );
          return voided.length > 0 ? 'voided' : 'already_void';
        }),
      );
      const payer = outcome(
        asApp(sessions[1], async (tx) => {
          const [request] = await tx.unsafe(`select status from public.payment_requests where id = $1`, [requestId]);
          await pause(30);
          if (request.status !== 'issued') return 'saw_void';
          await insertPayment(tx, requestId, '1000');
          return 'paid';
        }),
      );
      const key = (await Promise.all([voider, payer])).join('/');
      tally[key] = (tally[key] ?? 0) + 1;
      const [state] = await ownerQuery<{ status: string; pays: number }>(
        `select r.status, (select count(*)::int from public.contract_payments p where p.request_id = r.id) as pays
           from public.payment_requests r where r.id = $1`,
        [requestId],
      );
      if (state.status === 'void' && state.pays > 0) corrupt += 1;
    }
    expect(corrupt, JSON.stringify(tally)).toBe(0);
    // Every race had exactly one winner. The loser was refused by the DATABASE
    // (MT130 / MT132), or, when the scheduler let one leg finish before the
    // other looked, saw the result itself; at least one race must be a real
    // overlap, or this proved nothing.
    for (const key of Object.keys(tally)) {
      expect(key, JSON.stringify(tally)).toMatch(/^(voided\/MT130|MT132\/paid|has_payments\/paid|voided\/saw_void)$/);
    }
    expect((tally['voided/MT130'] ?? 0) + (tally['MT132/paid'] ?? 0), JSON.stringify(tally)).toBeGreaterThan(0);
  });

  it(`two full payments of one request: never overpaid (${String(RUNS_MONEY)} races)`, async () => {
    const tally: Record<string, number> = {};
    let overpaid = 0;
    for (let run = 0; run < RUNS_MONEY; run += 1) {
      const requestId = await freshRequest('1000');
      const pay = (session: Session) =>
        outcome(
          asApp(session, async (tx) => {
            const [paid] = await tx.unsafe(
              `select coalesce(sum(amount), 0) as s from public.contract_payments where request_id = $1`,
              [requestId],
            );
            await pause(20);
            if (1000 - Number(paid.s) < 1000) return 'saw_paid';
            await insertPayment(tx, requestId, '1000');
            return 'paid';
          }),
        );
      const key = (await Promise.all([pay(sessions[2]), pay(sessions[3])])).sort().join('/');
      tally[key] = (tally[key] ?? 0) + 1;
      const [state] = await ownerQuery<{ s: string }>(
        `select coalesce(sum(amount), 0) as s from public.contract_payments where request_id = $1`,
        [requestId],
      );
      if (Number(state.s) > 1000) overpaid += 1;
    }
    expect(overpaid, JSON.stringify(tally)).toBe(0);
    for (const key of Object.keys(tally)) expect(key, JSON.stringify(tally)).toMatch(/^(MT131\/paid|paid\/saw_paid)$/);
    expect(tally['MT131/paid'] ?? 0, JSON.stringify(tally)).toBeGreaterThan(0);
  });

  it('a keyed replay racing its first write records ONE payment and refuses neither', async () => {
    const requestId = await freshRequest('1000');
    const key = `replay-${requestId}`;
    const write = (session: Session) =>
      outcome(
        asApp(session, async (tx) => {
          const rows = await insertPayment(tx, requestId, '1000', key);
          await tx.unsafe('select pg_sleep(0.03)');
          return rows.length > 0 ? 'recorded' : 'already';
        }),
      );
    const outcomes = (await Promise.all([write(sessions[0]), write(sessions[1])])).sort();
    expect(outcomes).toEqual(['already', 'recorded']);
    const [state] = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from public.contract_payments where request_id = $1`,
      [requestId],
    );
    expect(state.n).toBe(1);
  });

  it('refuses a payment on a void request (MT130) and past the amount (MT131), and a void of a paid request (MT132)', async () => {
    const voided = await freshRequest('500');
    await ownerQuery(
      `update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2 where id = $1`,
      [voided, ownerId],
    );
    const onVoid = await outcome(asApp(sessions[0], async (tx) => (await insertPayment(tx, voided, '1'), 'paid')));
    expect(onVoid).toBe('MT130');

    const open = await freshRequest('500');
    await asApp(sessions[0], (tx) => insertPayment(tx, open, '300'));
    const past = await outcome(asApp(sessions[0], async (tx) => (await insertPayment(tx, open, '200.0001'), 'paid')));
    expect(past).toBe('MT131');
    await asApp(sessions[0], (tx) => insertPayment(tx, open, '200'));
    const voidPaid = await outcome(
      asApp(sessions[0], async (tx) => {
        await tx.unsafe(
          `update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2 where id = $1`,
          [open, ownerId],
        );
        return 'voided';
      }),
    );
    expect(voidPaid).toBe('MT132');
  });
});
