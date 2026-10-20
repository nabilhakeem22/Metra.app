import { createSql } from '@metra/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acknowledgeContractByToken } from '@/lib/contracts/public';
import { answered } from '@/lib/share/portal-act-failure';
import { hashShareToken } from '@/lib/share/token';
import { closeExecutionFixture, ownerQuery, seedExecutionContract } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// The /c token SQL under load (rls/functions/30-contracts-variations.sql), from
// the A3 reliability round:
//  - R2: the acknowledgement waits at most 4 s on a studio transaction holding
//    the contract row, like the delivery token writes (0060). It fails with
//    55P03 and rolls back whole, so the client is answered in about 4 s, and
//    nothing commits after that answer.
//  - R4: a page of one section's lines reads that section's rows only, never
//    every line of the contract.

const orgIds: string[] = [];
let orgId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'project_manager' }] });
  orgId = seeded.orgId;
  orgIds.push(orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

class Released extends Error {}

/** A studio transaction holding the contract row FOR UPDATE on its own
 *  connection until `release`; it lets go after `maxMs` whatever happens. */
async function holdContractRow(contractId: string, maxMs = 9000) {
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
      await tx.unsafe(`select 1 from public.contracts where id = $1 for update`, [contractId]);
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

async function landed(contractId: string) {
  const [row] = await ownerQuery<{ status: string; events: number; notes: number }>(
    `select c.status,
            (select count(*)::int from public.contract_events e where e.contract_id = c.id and e.kind = 'acknowledged') as events,
            (select count(*)::int from public.notifications n where n.entity_id = c.id) as notes
       from public.contracts c where c.id = $1`,
    [contractId],
  );
  return row;
}

describe('R2: the acknowledgement behind a held contract row', () => {
  it('carries lock_timeout 4s, and stays callable by metra_app only', async () => {
    const [row] = await ownerQuery<{ config: string[]; metra_app: boolean; public_grants: number }>(
      `select p.proconfig as config,
              has_function_privilege('metra_app', p.oid, 'execute') as metra_app,
              (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0) as public_grants
         from pg_proc p
        where p.oid = 'public.app_contract_ack_by_token(text, text, text, text, text)'::regprocedure`,
    );
    expect({ ...row, config: [...row.config].sort() }).toEqual({
      config: ['lock_timeout=4s', 'search_path=""'],
      metra_app: true,
      public_grants: 0,
    });
  });

  it('fails with 55P03 in about 4 s, writes nothing, keeps the caller lock_timeout, then signs once the row is free', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [2], state: 'issued' });
    const hash = hashShareToken(contract.rawToken!);
    const caller = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
    try {
      // The caller would wait for ever on its own: only the function's 4 s can fire.
      await caller.unsafe(`set lock_timeout = 0`);
      const call = () =>
        caller.unsafe<Array<{ code: string }>>(
          `select public.app_contract_ack_by_token($1, 'Client', null, null, null) as code`,
          [hash],
        );
      const held = await holdContractRow(contract.contractId);
      const started = performance.now();
      const outcome = await call().then(([row]) => row.code, (error: unknown) => sqlstateOf(error) ?? String(error));
      const ms = performance.now() - started;
      await held.release();
      expect(outcome).toBe('55P03');
      expect(ms).toBeGreaterThanOrEqual(3900);
      expect(ms).toBeLessThanOrEqual(6000);
      expect(await landed(contract.contractId)).toEqual({ status: 'issued', events: 0, notes: 0 });
      const [{ lock_timeout: after }] = await caller.unsafe<Array<{ lock_timeout: string }>>('show lock_timeout');
      expect(after).toBe('0');

      const [free] = await call();
      expect(free.code).toBe('ok');
      expect(await landed(contract.contractId)).toEqual({ status: 'signed', events: 1, notes: 3 });
    } finally {
      await caller.end();
    }
  }, 30_000);

  it('the /c act answers uncertain in under 6 s, and nothing commits after the answer', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [2], state: 'issued' });
    const held = await holdContractRow(contract.contractId);
    const started = performance.now();
    // The acknowledgeContract server action's own shape (c/[token]/actions.ts),
    // without its request headers.
    const answer = await answered(
      'acknowledgeContract',
      (failure) => ({ ok: false as const, ...failure }),
      () => acknowledgeContractByToken(contract.rawToken!, { actorName: 'Client' }),
    );
    const ms = performance.now() - started;
    // 55P03 is ambiguous by contract (db-failure.ts): the client is told to
    // refresh and check, which here finds the contract still open to sign.
    expect(answer).toEqual({ ok: false, error: 'uncertain' });
    expect(ms).toBeLessThan(6000);
    await held.release();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await landed(contract.contractId)).toEqual({ status: 'issued', events: 0, notes: 0 });
    expect(await acknowledgeContractByToken(contract.rawToken!, { actorName: 'Client' })).toEqual({ ok: true });
  }, 30_000);
});

describe('R4: a page of lines reads one section, not the contract', () => {
  it('no scan of contract_lines returns more rows than the page asks for, beside a 3,000-line section', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [3000, 120], state: 'issued' });
    const hash = hashShareToken(contract.rawToken!);
    const plans: string[] = [];
    // postgres.js directly: createSql does not pass a notice handler through,
    // and auto_explain hands each nested plan back as a NOTICE.
    const probe = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      prepare: false,
      onnotice: (notice) => plans.push(String(notice.message)),
    });
    try {
      await probe.unsafe(`load 'auto_explain'`);
      await probe.unsafe(
        `set auto_explain.log_min_duration = 0; set auto_explain.log_nested_statements = on;
         set auto_explain.log_analyze = on; set auto_explain.log_level = notice; set client_min_messages = notice`,
      );
      const [page] = await probe.unsafe<Array<{ data: { line_count: number; lines: Array<{ id: string }> } }>>(
        `select public.app_contract_section_lines_by_token($1, $2::uuid, 0) as data`,
        [hash, contract.sectionIds[1]],
      );
      expect(page.data.line_count).toBe(120);
      expect(page.data.lines.map((line) => line.id)).toEqual(contract.lineIds[1].slice(0, 100));
    } finally {
      await probe.end();
    }
    // The rows each scan of contract_lines touched: what it returned, plus what
    // its filter read and threw away.
    const touched: number[] = [];
    const planLines = plans
      .filter((plan) => !plan.includes('app_contract_section_lines_by_token($1'))
      .flatMap((plan) => plan.split('\n'));
    for (const line of planLines) {
      const node = / on contract_lines .*actual time=[\d.]+\.\.[\d.]+ rows=(\d+)/.exec(line);
      if (node) touched.push(Number(node[1]));
      else if (/^\s*->/.test(line)) touched.push(-1);
      const removed = /Rows Removed by (?:Filter|Index Recheck): (\d+)/.exec(line);
      if (removed && touched.length > 0 && touched[touched.length - 1] >= 0) touched[touched.length - 1] += Number(removed[1]);
    }
    const scans = touched.filter((rows) => rows >= 0);
    expect(scans.length).toBeGreaterThan(0);
    // The section holds 120 lines: the count reads 120, the page 101 at most,
    // each picked line one row; never the 3,000 lines beside it.
    for (const rows of scans) expect(rows).toBeLessThanOrEqual(120);
  }, 60_000);
});
