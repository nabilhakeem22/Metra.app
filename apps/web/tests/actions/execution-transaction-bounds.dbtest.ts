import { randomUUID } from 'node:crypto';
import { createSql } from '@metra/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { terminateContractCore } from '@/lib/contracts/lifecycle/terminate';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { issueFinalAccountCore } from '@/lib/execution/final-account/issue';
import { seedBillableContract } from './execution-billing-fixture';
import { seedReading } from './execution-final-account-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// How a transaction is opened (packages/db org-context.ts TransactionOptions).
//
// A5 reliability R2: the final account card reads in ONE snapshot
// (REPEATABLE READ READ ONLY), so a write committing while it is read is in
// every figure or in none.
//
// A5 reliability R1: a share lock does not queue behind a waiting FOR UPDATE,
// so a steady stream of overlapping FOR SHARE holders on a contract (the
// measurement and approval cores, final-account/gate.ts) re-starts the
// writer's wait with every new holder set, each with a fresh 5 s
// lock_timeout: the tester measured a writer held 20 s, until
// statement_timeout. Every contract FOR UPDATE writer now caps its whole
// transaction at 8 s (`capTransaction`, transaction_timeout, PostgreSQL 17+),
// answered `uncertain`, with nothing written.

const STREAM_MS = 11_000;
const HOLD_MS = 300;
const EVERY_MS = 150;

const holders = createSql(process.env.DATABASE_URL as string, { max: 12, prepare: false });
const orgIds: string[] = [];
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  owner = ctxFor(seeded.orgId, seeded.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await holders.end();
  await closeExecutionFixture();
  await closeFixture();
});

/** Overlapping FOR SHARE holders of the contract row, one every EVERY_MS, each held HOLD_MS, for STREAM_MS. */
async function shareStream(contractId: string): Promise<number> {
  const started = Date.now();
  const running: Promise<unknown>[] = [];
  while (Date.now() - started < STREAM_MS) {
    running.push(
      holders.begin(async (tx) => {
        await tx`select 1 from public.contracts where id = ${contractId} for share`;
        await tx`select pg_sleep(${HOLD_MS / 1000})`;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
  }
  await Promise.all(running);
  return running.length;
}

async function timed<T>(run: Promise<T>): Promise<{ result: T; ms: number }> {
  const started = Date.now();
  const result = await run;
  return { result, ms: Date.now() - started };
}

describe('a contract writer under a steady FOR SHARE stream', () => {
  it('R1: the final account issue and the termination end at the 8 s cap, uncertain, and write nothing', async () => {
    const [server] = await ownerQuery<{ version: number }>(`select current_setting('server_version_num')::integer as version`);
    expect(server.version, 'the cap needs PostgreSQL 17, which CI and production run').toBeGreaterThanOrEqual(170000);
    // One contract per writer, so the two writers never wait on each other (that wait is lock_timeout's).
    const billed = await seedBillableContract(orgIds[0]);
    const ended = await seedBillableContract(orgIds[0]);
    const streams = Promise.all([shareStream(billed.contractId), shareStream(ended.contractId)]);
    await new Promise((resolve) => setTimeout(resolve, 2 * EVERY_MS));

    const [issued, terminated] = await Promise.all([
      timed(issueFinalAccountCore(owner, { contractId: billed.contractId, expectedAmount: '124000' })),
      timed(terminateContractCore(owner, { id: ended.contractId })),
    ]);
    const holderCounts = await streams;

    for (const writer of [issued, terminated]) {
      expect(writer.result).toEqual({ ok: false, error: 'uncertain' });
      expect(writer.ms).toBeGreaterThan(7_500);
      expect(writer.ms).toBeLessThan(9_500);
    }
    for (const count of holderCounts) expect(count).toBeGreaterThan(50);
    const after = await ownerQuery<{ status: string; requests: number }>(
      `select c.status, (select count(*)::int from public.payment_requests r where r.contract_id = c.id) as requests
         from public.contracts c where c.id = any($1::uuid[]) order by c.id`,
      [[billed.contractId, ended.contractId]],
    );
    expect(after).toEqual([{ status: 'signed', requests: 0 }, { status: 'signed', requests: 0 }]);

    // Once the stream ends, the same acts go through.
    expect(await issueFinalAccountCore(owner, { contractId: billed.contractId, expectedAmount: '124000' })).toMatchObject({ ok: true });
    expect(await terminateContractCore(owner, { id: ended.contractId })).toEqual({ ok: true });
  });

  it('a capped writer that finishes in time leaves no cap on its connection', async () => {
    const contract = await seedBillableContract(orgIds[0]);
    expect(await terminateContractCore(owner, { id: contract.contractId })).toEqual({ ok: true });
    const [session] = await ownerQuery<{ cap: string }>(`select current_setting('transaction_timeout') as cap`);
    expect(session.cap).toBe('0');
  });
});

describe('a snapshot read', () => {
  it('R2: every statement sees the moment it began, and it writes nothing', async () => {
    const contract = await seedExecutionContract(orgIds[0], { state: 'signed' });
    const line = contract.lineIds[0][0];
    const readings = (tx: Parameters<Parameters<typeof withOrgContext>[1]>[0]) =>
      tx.execute(sql`select count(*)::int as n from public.contract_line_measurements where contract_id = ${contract.contractId}`);
    const seen = await withOrgContext(
      owner,
      async (tx) => {
        const before = ((await readings(tx)) as unknown as Array<{ n: number }>)[0].n;
        await seedReading(orgIds[0], contract.contractId, line, '7', owner.userId);
        const after = ((await readings(tx)) as unknown as Array<{ n: number }>)[0].n;
        return { before, after };
      },
      { snapshot: true },
    );
    // The reading committed between the two statements is not in the second.
    expect(seen).toEqual({ before: 0, after: 0 });
    // Read only: even a row lock is refused (25006).
    const write = await withOrgContext(owner, (tx) => tx.execute(sql`select 1 from public.contracts where id = ${randomUUID()} for update`), {
      snapshot: true,
    }).then(
      () => null,
      (error: unknown) => sqlstateOf(error) ?? 'unknown',
    );
    expect(write).toBe('25006');
    const [committed] = await ownerQuery<{ n: number }>(`select count(*)::int as n from public.contract_line_measurements where contract_id = $1`, [contract.contractId]);
    expect(committed.n).toBe(1);
  });
});
