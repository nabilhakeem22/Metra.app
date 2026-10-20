import { createSql } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appQuery,
  closeExecutionFixture,
  ownerQuery,
  seedExecutionContract,
  seedRequest,
  sqlstate,
  tamper,
  type ExecutionContract,
} from './execution-fixture';
import { seedBillableContract, seedPendingClaim, type BilledContract } from './execution-billing-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// DB step B, apply-rls only, no migration:
//   * the cost entry hardening (B3 security S2): metra_app may UPDATE only the
//     entry fields and the void stamp, and trg_contract_cost_entries_guarded
//     refuses a re-homed, un-voided or (B4 S2) edited-once-voided entry to
//     every role;
//   * the actor check (A4 security S3): a payment request's issued_by and
//     voided_by, a payment's recorded_by, a cost entry's recorded_by and
//     voided_by (B4 S2), a claim's resolved_by (B4 S1) and a measurement's
//     recorded_by (A5 S2) name the session's user (app.current_user_id) for
//     metra_app, MT140 otherwise; a misnamed column fails closed (B4 S3);
//   * the client claim (B4 security S1): metra_app may not insert one, may
//     update only the answer's columns, and the guard keeps the client's
//     evidence and admits only pending -> confirmed | dismissed;
//   * the measurement ledger guard (A5 security S2): a signed execution
//     contract with no issued final account, a day from its issue to
//     tomorrow, and created_at = now().

const orgIds: string[] = [];
let orgId: string;
let owner: string;
let accountant: string;
let contract: ExecutionContract;
let billed: BilledContract;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'accountant' }] });
  orgId = seeded.orgId;
  orgIds.push(orgId);
  owner = seeded.ownerIds[0];
  accountant = seeded.memberIds[0];
  contract = await seedExecutionContract(orgId, { state: 'signed' });
  billed = await seedBillableContract(orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

async function seedEntry(costItemId: string | null = null): Promise<string> {
  const [row] = await ownerQuery<{ id: string }>(
    `insert into public.contract_cost_entries
       (org_id, contract_id, category, description, amount, incurred_on, recorded_by, idempotency_key, cost_item_id)
     values ($1, $2, 'materials', 'Tiles', 100, current_date, $3, gen_random_uuid()::text, $4) returning id`,
    [orgId, contract.contractId, accountant, costItemId],
  );
  return row.id;
}

const asAccountant = (text: string, params: unknown[] = []) => appQuery(orgId, accountant, text, params);

describe('cost entries: column-level UPDATE and the guard (B3 security S2)', () => {
  it('lets metra_app edit the entry fields and void it, and nothing else', async () => {
    const id = await seedEntry();
    expect(await sqlstate(asAccountant(`update public.contract_cost_entries set amount = 250, description = 'Paint', supplier = 'Acme' where id = $1`, [id]))).toBeNull();
    for (const column of ['contract_id', 'recorded_by', 'idempotency_key', 'created_at', 'org_id']) {
      const value = column === 'created_at' ? 'now()' : column === 'idempotency_key' ? `'other'` : `'${owner}'`;
      expect({ column, code: await sqlstate(asAccountant(`update public.contract_cost_entries set ${column} = ${value} where id = $1`, [id])) }).toEqual({ column, code: '42501' });
    }
    expect(await sqlstate(asAccountant(`update public.contract_cost_entries set voided_at = now(), voided_by = $2, updated_at = now() where id = $1`, [id, accountant]))).toBeNull();
  });

  it('refuses a re-homed, re-owned, re-keyed or re-dated entry to the connection role too (MT100)', async () => {
    const id = await seedEntry();
    const other = await seedExecutionContract(orgId, { state: 'signed' });
    for (const assignment of [
      `contract_id = '${other.contractId}'`,
      `recorded_by = '${owner}'`,
      `idempotency_key = 'other'`,
      `created_at = now() - interval '1 day'`,
    ]) {
      expect({ assignment, code: await sqlstate(ownerQuery(`update public.contract_cost_entries set ${assignment} where id = $1`, [id])) }).toEqual({ assignment, code: 'MT100' });
    }
  });

  it('refuses an un-void and a rewritten void stamp, and still lets a deleted price-book item go', async () => {
    const [section] = await ownerQuery<{ id: string }>(`select id from public.sections where org_id = $1 limit 1`, [orgId]);
    const [item] = await ownerQuery<{ id: string }>(
      `insert into public.cost_items (org_id, code, name_en, section_id, unit) values ($1, 'T-1', 'Tile', $2, 'sqm') returning id`,
      [orgId, section.id],
    );
    const id = await seedEntry(item.id);
    await ownerQuery(`update public.contract_cost_entries set voided_at = now(), voided_by = $2 where id = $1`, [id, accountant]);
    expect(await sqlstate(asAccountant(`update public.contract_cost_entries set voided_at = null, voided_by = null where id = $1`, [id]))).toBe('MT100');
    expect(await sqlstate(ownerQuery(`update public.contract_cost_entries set voided_by = $2 where id = $1`, [id, owner]))).toBe('MT100');
    expect(await sqlstate(ownerQuery(`delete from public.cost_items where id = $1`, [item.id]))).toBeNull();
    const [after] = await ownerQuery<{ cost_item_id: string | null; voided: boolean }>(
      `select cost_item_id, voided_at is not null as voided from public.contract_cost_entries where id = $1`,
      [id],
    );
    expect(after).toEqual({ cost_item_id: null, voided: true });
  });
});

describe('the actor is the session user (A4 security S3, MT140)', () => {
  const insertRequest = (issuedBy: string, milestoneIndex: number) =>
    asAccountant(
      `insert into public.payment_requests (org_id, contract_id, number, kind, milestone_id, amount, tax_amount, issued_on, issued_by)
       values ($1, $2, (select coalesce(max(number), 0) + 1 from public.payment_requests where org_id = $1), 'milestone', $3, 500, 0, current_date, $4)
       returning id`,
      [orgId, billed.contractId, billed.milestoneIds[milestoneIndex], issuedBy],
    );

  it('a payment request is issued, and voided, only in the session user name', async () => {
    expect(await sqlstate(insertRequest(owner, 0))).toBe('MT140');
    const [request] = (await insertRequest(accountant, 0)) as Array<{ id: string }>;
    const voidAs = (voidedBy: string) =>
      asAccountant(`update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2, updated_at = now() where id = $1`, [request.id, voidedBy]);
    expect(await sqlstate(voidAs(owner))).toBe('MT140');
    expect(await sqlstate(voidAs(accountant))).toBeNull();
  });

  it('a payment and a cost entry are recorded only in the session user name', async () => {
    const [request] = (await insertRequest(accountant, 1)) as Array<{ id: string }>;
    const pay = (recordedBy: string) =>
      asAccountant(
        `insert into public.contract_payments (org_id, contract_id, request_id, amount, received_on, recorded_by) values ($1, $2, $3, 1, current_date, $4)`,
        [orgId, billed.contractId, request.id, recordedBy],
      );
    expect(await sqlstate(pay(owner))).toBe('MT140');
    expect(await sqlstate(pay(accountant))).toBeNull();
    const cost = (recordedBy: string) =>
      asAccountant(
        `insert into public.contract_cost_entries (org_id, contract_id, category, description, amount, incurred_on, recorded_by)
         values ($1, $2, 'labour', 'Crew', 10, current_date, $3)`,
        [orgId, contract.contractId, recordedBy],
      );
    expect(await sqlstate(cost(owner))).toBe('MT140');
    expect(await sqlstate(cost(accountant))).toBeNull();
  });

  it('asks nothing of the connection role (migrations, the CLIs, the fixtures)', async () => {
    const [row] = await ownerQuery<{ id: string }>(
      `insert into public.contract_cost_entries (org_id, contract_id, category, description, amount, incurred_on, recorded_by)
       values ($1, $2, 'other', 'Script', 1, current_date, $3) returning id`,
      [orgId, contract.contractId, owner],
    );
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('cost entries: the void stamp names the session user, and a voided entry is final (B4 security S2)', () => {
  it('voids only in the session user name', async () => {
    const id = await seedEntry();
    const voidAs = (voidedBy: string) =>
      asAccountant(`update public.contract_cost_entries set voided_at = now(), voided_by = $2, updated_at = now() where id = $1`, [id, voidedBy]);
    expect(await sqlstate(voidAs(owner))).toBe('MT140');
    expect(await sqlstate(voidAs(accountant))).toBeNull();
  });

  it('refuses any edit of a voided entry, to metra_app and to the connection role (MT100)', async () => {
    const id = await seedEntry();
    await ownerQuery(`update public.contract_cost_entries set voided_at = now(), voided_by = $2 where id = $1`, [id, accountant]);
    expect(await sqlstate(asAccountant(`update public.contract_cost_entries set amount = 999999 where id = $1`, [id]))).toBe('MT100');
    expect(await sqlstate(asAccountant(`update public.contract_cost_entries set updated_at = now() where id = $1`, [id]))).toBe('MT100');
    expect(await sqlstate(ownerQuery(`update public.contract_cost_entries set description = 'Edited' where id = $1`, [id]))).toBe('MT100');
    const [after] = await ownerQuery<{ amount: string; description: string }>(
      `select amount::text, description from public.contract_cost_entries where id = $1`,
      [id],
    );
    expect(after).toEqual({ amount: '100.0000', description: 'Tiles' });
  });
});

describe("the client's claim: written by the client's link only, answered once (B4 security S1)", () => {
  /** A request of its own contract (one final account each), and a pending claim on it. */
  const pendingClaim = async () => {
    const own = await seedExecutionContract(orgId, { state: 'signed' });
    const requestId = await seedRequest(orgId, own.contractId, owner, {}, '100');
    return seedPendingClaim(orgId, own.contractId, requestId);
  };

  it('gives metra_app no INSERT: a claim the client never sent cannot be made up (42501)', async () => {
    const own = await seedExecutionContract(orgId, { state: 'signed' });
    const requestId = await seedRequest(orgId, own.contractId, owner, {}, '100');
    expect(
      await sqlstate(
        asAccountant(
          `insert into public.contract_payment_claims (org_id, contract_id, request_id, claimed_amount, actor_name, actor_ip)
           values ($1, $2, $3, 100, 'Client', '41.1.1.1')`,
          [orgId, own.contractId, requestId],
        ),
      ),
    ).toBe('42501');
  });

  it("lets metra_app write only the answer's columns, never the client's evidence (42501)", async () => {
    const id = await pendingClaim();
    for (const assignment of [
      `actor_ip = '9.9.9.9'`,
      `note = 'edited'`,
      `claimed_amount = 1`,
      `actor_name = 'Someone'`,
      `actor_user_agent = 'x'`,
      `created_at = now()`,
      `request_id = request_id`,
    ]) {
      expect({ assignment, code: await sqlstate(asAccountant(`update public.contract_payment_claims set ${assignment} where id = $1`, [id])) }).toEqual({
        assignment,
        code: '42501',
      });
    }
  });

  it("keeps the client's evidence against the connection role too, and answers a claim once (MT100)", async () => {
    const id = await pendingClaim();
    for (const assignment of [`actor_ip = '9.9.9.9'`, `note = 'edited'`, `claimed_amount = 1`, `created_at = now() - interval '1 day'`]) {
      expect({ assignment, code: await sqlstate(ownerQuery(`update public.contract_payment_claims set ${assignment} where id = $1`, [id])) }).toEqual({
        assignment,
        code: 'MT100',
      });
    }
    expect(await sqlstate(ownerQuery(`update public.contract_payment_claims set updated_at = now() where id = $1`, [id]))).toBe('MT100');
    expect(
      await sqlstate(
        asAccountant(
          `update public.contract_payment_claims set status = 'dismissed', resolved_at = now(), resolved_by = $2, updated_at = now() where id = $1`,
          [id, accountant],
        ),
      ),
    ).toBeNull();
    expect(
      await sqlstate(ownerQuery(`update public.contract_payment_claims set status = 'pending', resolved_at = null, resolved_by = null where id = $1`, [id])),
    ).toBe('MT100');
    expect(await sqlstate(ownerQuery(`update public.contract_payment_claims set resolved_by = $2 where id = $1`, [id, owner]))).toBe('MT100');
  });

  it('records the answer only in the session user name (MT140)', async () => {
    const id = await pendingClaim();
    const dismissAs = (resolvedBy: string) =>
      asAccountant(
        `update public.contract_payment_claims set status = 'dismissed', resolved_at = now(), resolved_by = $2, updated_at = now() where id = $1`,
        [id, resolvedBy],
      );
    expect(await sqlstate(dismissAs(owner))).toBe('MT140');
    expect(await sqlstate(dismissAs(accountant))).toBeNull();
  });
});

describe('the actor check fails closed on a column it cannot find (B4 security S3)', () => {
  const session = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
  afterAll(async () => {
    await session.end();
  });

  it('refuses a metra_app write when an argument names no column (MT100), and the probe leaves nothing behind', async () => {
    const rolledBack = new Error('roll the probe back');
    let code: string | null = null;
    await session
      .begin(async (tx) => {
        await tx.unsafe(`create table public.zz_actor_probe (id int, recorded_by uuid)`);
        await tx.unsafe(`grant insert on public.zz_actor_probe to metra_app`);
        await tx.unsafe(
          `create trigger zz_actor_probe_actor before insert on public.zz_actor_probe
             for each row execute function public.enforce_actor_is_session_user('recorded_by', 'recroded_by')`,
        );
        await tx`select set_config('app.current_user_id', ${accountant}, true)`;
        await tx.unsafe('set local role metra_app');
        await tx.unsafe('savepoint probe');
        code = await sqlstate(tx.unsafe(`insert into public.zz_actor_probe values (1, $1)`, [accountant]));
        await tx.unsafe('rollback to savepoint probe');
        throw rolledBack;
      })
      .catch((error: unknown) => {
        if (error !== rolledBack) throw error;
      });
    expect(code).toBe('MT100');
    const [left] = await ownerQuery<{ n: number }>(`select count(*)::int as n from pg_class where relname = 'zz_actor_probe'`);
    expect(left.n).toBe(0);
  });
});

describe('the measurement ledger guard (A5 security S2)', () => {
  let signed: ExecutionContract;

  beforeAll(async () => {
    signed = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [2] });
    await tamper(`update public.contracts set created_at = now() - interval '30 days' where id = $1`, [signed.contractId]);
  });

  /** The day `offsetDays` from today, in Cairo, as the guard reads it. */
  const day = async (offsetDays: number) => {
    const [row] = await ownerQuery<{ d: string }>(
      `select to_char((now() at time zone 'Africa/Cairo')::date + $1::int, 'YYYY-MM-DD') as d`,
      [offsetDays],
    );
    return row.d;
  };
  const measure = (target: ExecutionContract, recordedBy: string, measuredOn: string) =>
    asAccountant(
      `insert into public.contract_line_measurements
         (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by)
       values ($1, $2, $3, 5, $4, $5) returning id`,
      [orgId, target.contractId, target.lineIds[0][0], measuredOn, recordedBy],
    );

  it('records a reading only in the session user name (MT140)', async () => {
    expect(await sqlstate(measure(signed, owner, await day(0)))).toBe('MT140');
    expect(await sqlstate(measure(signed, accountant, await day(0)))).toBeNull();
  });

  it('refuses a reading on a contract that is not signed, or terminated (MT100)', async () => {
    const issued = await seedExecutionContract(orgId, { state: 'issued' });
    expect(await sqlstate(measure(issued, accountant, await day(0)))).toBe('MT100');
    const ended = await seedExecutionContract(orgId, { state: 'signed' });
    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [ended.contractId]);
    expect(await sqlstate(measure(ended, accountant, await day(0)))).toBe('MT100');
  });

  it('refuses a reading once a final account is issued, and takes one again once it is void (MT100)', async () => {
    const open = await seedExecutionContract(orgId, { state: 'signed' });
    const finalAccount = await seedRequest(orgId, open.contractId, owner, {}, '100');
    expect(await sqlstate(measure(open, accountant, await day(0)))).toBe('MT100');
    await ownerQuery(
      `update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2, updated_at = now() where id = $1`,
      [finalAccount, owner],
    );
    expect(await sqlstate(measure(open, accountant, await day(0)))).toBeNull();
  });

  it('refuses a day before the contract was issued or after tomorrow, in Cairo (MT100)', async () => {
    expect(await sqlstate(measure(signed, accountant, await day(-31)))).toBe('MT100');
    expect(await sqlstate(measure(signed, accountant, await day(-30)))).toBeNull();
    expect(await sqlstate(measure(signed, accountant, await day(1)))).toBeNull();
    expect(await sqlstate(measure(signed, accountant, await day(2)))).toBe('MT100');
  });

  it('stamps created_at with the insert time, for every role', async () => {
    const [mine] = (await asAccountant(
      `insert into public.contract_line_measurements
         (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by, created_at)
       values ($1, $2, $3, 5, current_date, $4, '2020-01-01T00:00:00Z') returning id`,
      [orgId, signed.contractId, signed.lineIds[0][0], accountant],
    )) as Array<{ id: string }>;
    const [script] = await ownerQuery<{ id: string }>(
      `insert into public.contract_line_measurements (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by, created_at)
       values ($1, $2, $3, 6, current_date, $4, '2020-01-01T00:00:00Z') returning id`,
      [orgId, signed.contractId, signed.lineIds[0][1], owner],
    );
    const rows = await ownerQuery<{ recent: boolean }>(
      `select created_at > now() - interval '1 minute' as recent from public.contract_line_measurements where id = any($1::uuid[])`,
      [[mine.id, script.id]],
    );
    expect(rows).toEqual([{ recent: true }, { recent: true }]);
  });
});
