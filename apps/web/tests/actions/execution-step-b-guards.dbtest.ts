import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appQuery,
  closeExecutionFixture,
  ownerQuery,
  seedExecutionContract,
  sqlstate,
  type ExecutionContract,
} from './execution-fixture';
import { seedBillableContract, type BilledContract } from './execution-billing-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// DB step B, apply-rls only, no migration:
//   * the cost entry hardening (B3 security S2): metra_app may UPDATE only the
//     entry fields and the void stamp, and trg_contract_cost_entries_guarded
//     refuses a re-homed or un-voided entry to every role;
//   * the actor check (A4 security S3): a payment request's issued_by and
//     voided_by, a payment's recorded_by and a cost entry's recorded_by name
//     the session's user (app.current_user_id) for metra_app, MT140 otherwise.

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
