import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appQuery,
  closeExecutionFixture,
  ownerQuery,
  seedClientProject,
  seedExecutionContract,
  seedMilestone,
  seedRequest,
  seedVariation,
  sqlstate,
  type ExecutionContract,
} from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Stage 2 DB step A (migration 0063 + apply-rls): the six execution tables'
// CHECKs, partial uniques, 3-column FKs, the payment request frozen trigger,
// the schedule's draft guard, the grants, and org isolation with REAL rows
// (the isolation gate's seed has none in these tables). Every write that
// stands for an app write runs as metra_app inside a member's org context.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let otherOrgId: string;
let otherOwnerId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  const other = await seedOrg({ owners: 1 });
  otherOrgId = other.orgId;
  otherOwnerId = other.ownerIds[0];
  orgIds.push(orgId, otherOrgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const app = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  appQuery<T>(orgId, ownerId, text, params);

async function insertRequest(contractId: string, fields: Record<string, unknown>) {
  const row = {
    org_id: orgId,
    contract_id: contractId,
    number: Math.floor(Math.random() * 1_000_000_000),
    kind: 'final_account',
    amount: '100',
    tax_amount: '0',
    issued_on: '2026-10-19',
    issued_by: ownerId,
    ...fields,
  };
  const columns = Object.keys(row);
  return app(
    `insert into public.payment_requests (${columns.join(', ')})
     values (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
    Object.values(row),
  );
}

describe('contracts: exactly one source (0063)', () => {
  it('refuses a contract with both sources, and one with neither (23514)', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'draft' });
    const [proposal] = await ownerQuery<{ id: string }>(
      `insert into public.proposals (org_id, number, title_en, client_id, project_id, status)
       values ($1, 900000 + floor(random() * 99999)::int, 'Quote', $2, $3, 'accepted') returning id`,
      [orgId, contract.clientId, contract.projectId],
    );
    expect(
      await sqlstate(
        app(`update public.contracts set source_proposal_id = $2 where id = $1`, [contract.contractId, proposal.id]),
      ),
    ).toBe('23514');
    expect(
      await sqlstate(app(`update public.contracts set source_boq_id = null where id = $1`, [contract.contractId])),
    ).toBe('23514');
  });

  it('allows one contract per BOQ (contracts_org_id_source_boq_unique)', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'draft' });
    const error = await app(
      `insert into public.contracts (org_id, number, title_en, source_boq_id, client_id, project_id)
       values ($1, 990000 + floor(random() * 9999)::int, 'Twin', $2, $3, $4)`,
      [orgId, contract.boqId, contract.clientId, contract.projectId],
    ).catch((caught: { code?: string; constraint_name?: string }) => caught);
    expect(error).toMatchObject({ code: '23505', constraint_name: 'contracts_org_id_source_boq_unique' });
  });

  it("refuses another org's BOQ as the source (the same-org FK, 23503)", async () => {
    const foreign = await seedExecutionContract(otherOrgId, { state: 'draft' });
    const { clientId, projectId } = await seedClientProject(orgId);
    expect(
      await sqlstate(
        app(
          `insert into public.contracts (org_id, number, title_en, source_boq_id, client_id, project_id)
           values ($1, 980000 + floor(random() * 9999)::int, 'Cross', $2, $3, $4)`,
          [orgId, foreign.boqId, clientId, projectId],
        ),
      ),
    ).toBe('23503');
  });

  it('defaults a contract line to firm (provisional false) with no item code', async () => {
    const [column] = await ownerQuery<{ column_default: string; is_nullable: string }>(
      `select column_default, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'contract_lines' and column_name = 'provisional'`,
    );
    expect(column).toEqual({ column_default: 'false', is_nullable: 'NO' });
  });

  it('bounds a change order time extension to 0..3650 days (23514)', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    for (const days of [-1, 3651]) {
      expect(
        await sqlstate(seedVariation(orgId, contract, 'draft', { timeExtensionDays: days })),
      ).toBe('23514');
    }
    await expect(seedVariation(orgId, contract, 'draft', { timeExtensionDays: 3650 })).resolves.toBeDefined();
  });
});

describe('contract_payment_milestones: the signed schedule (AC8)', () => {
  it('refuses a zero value, an empty label and an 81-character label (23514)', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'draft' });
    const insert = (label: string | null, value: string) =>
      app(
        `insert into public.contract_payment_milestones (org_id, contract_id, label_en, basis, value, sort_order)
         values ($1, $2, $3, 'percent', $4, floor(random() * 100000)::int)`,
        [orgId, contract.contractId, label, value],
      );
    expect(await sqlstate(insert('Advance', '0'))).toBe('23514');
    expect(await sqlstate(insert('Advance', 'NaN'))).toBe('23514');
    expect(await sqlstate(insert(null, '50'))).toBe('23514');
    expect(await sqlstate(insert(' \t', '50'))).toBe('23514');
    expect(await sqlstate(insert('x'.repeat(81), '50'))).toBe('23514');
    await expect(insert('x'.repeat(80), '50')).resolves.toBeDefined();
  });

  it('is full DML while the contract is a draft, and MT100 for insert, update and delete once issued', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'draft' });
    const milestoneId = await seedMilestone(orgId, contract.contractId, 0);
    await expect(
      app(`update public.contract_payment_milestones set value = 60 where id = $1`, [milestoneId]),
    ).resolves.toBeDefined();
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [contract.contractId]);

    expect(
      await sqlstate(
        app(
          `insert into public.contract_payment_milestones (org_id, contract_id, label_en, basis, value, sort_order)
           values ($1, $2, 'Late', 'percent', 10, 7)`,
          [orgId, contract.contractId],
        ),
      ),
    ).toBe('MT100');
    expect(
      await sqlstate(app(`update public.contract_payment_milestones set value = 1 where id = $1`, [milestoneId])),
    ).toBe('MT100');
    expect(
      await sqlstate(app(`delete from public.contract_payment_milestones where id = $1`, [milestoneId])),
    ).toBe('MT100');
  });
});

describe('payment_requests: CHECKs and partial uniques (AC14, AC15, AC29)', () => {
  let contract: ExecutionContract;
  let milestoneId: string;
  let otherMilestoneId: string;

  beforeAll(async () => {
    contract = await seedExecutionContract(orgId, { state: 'draft' });
    milestoneId = await seedMilestone(orgId, contract.contractId, 0);
    otherMilestoneId = await seedMilestone(orgId, contract.contractId, 1);
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [contract.contractId]);
    await ownerQuery(`update public.contracts set status = 'signed' where id = $1`, [contract.contractId]);
  });

  it('ties the kind to exactly its own target (payment_requests_kind_target)', async () => {
    const variation = await seedVariation(orgId, contract, 'approved');
    const refused = [
      { kind: 'milestone' },
      { kind: 'milestone', milestone_id: milestoneId, variation_order_id: variation.id },
      { kind: 'variation', milestone_id: milestoneId },
      { kind: 'final_account', milestone_id: milestoneId },
      { kind: 'final_account', variation_order_id: variation.id },
    ];
    for (const fields of refused) {
      const error = await insertRequest(contract.contractId, fields).catch(
        (caught: { code?: string; constraint_name?: string }) => caught,
      );
      expect(error, JSON.stringify(fields)).toMatchObject({
        code: '23514',
        constraint_name: 'payment_requests_kind_target',
      });
    }
  });

  it('refuses a zero amount, VAT above the amount, a due date before the issue date and a 501-character note', async () => {
    for (const [fields, constraint] of [
      [{ amount: '0' }, 'payment_requests_amount_positive'],
      [{ amount: 'NaN', tax_amount: '0' }, 'payment_requests_amount_positive'],
      [{ tax_amount: 'NaN' }, 'payment_requests_tax_amount_range'],
      [{ amount: '100', tax_amount: '100.0001' }, 'payment_requests_tax_amount_range'],
      [{ tax_amount: '-1' }, 'payment_requests_tax_amount_range'],
      [{ due_on: '2026-10-18' }, 'payment_requests_due_after_issue'],
      [{ note: 'n'.repeat(501) }, 'payment_requests_note_length'],
    ] as const) {
      const error = await insertRequest(contract.contractId, fields).catch(
        (caught: { code?: string; constraint_name?: string }) => caught,
      );
      expect(error, constraint).toMatchObject({ code: '23514', constraint_name: constraint });
    }
  });

  it('ties void to voided_at and voided_by (payment_requests_void_pair)', async () => {
    for (const fields of [
      { status: 'void' },
      { status: 'void', voided_at: '2026-10-19T10:00:00Z' },
      { voided_at: '2026-10-19T10:00:00Z', voided_by: ownerId },
    ]) {
      const error = await insertRequest(contract.contractId, fields).catch(
        (caught: { code?: string; constraint_name?: string }) => caught,
      );
      expect(error, JSON.stringify(fields)).toMatchObject({
        code: '23514',
        constraint_name: 'payment_requests_void_pair',
      });
    }
  });

  it('holds ONE live request per milestone; a void frees the slot for a NEW number', async () => {
    const first = await seedRequest(orgId, contract.contractId, ownerId, { milestoneId });
    const twin = await insertRequest(contract.contractId, { kind: 'milestone', milestone_id: milestoneId }).catch(
      (caught: { code?: string; constraint_name?: string }) => caught,
    );
    expect(twin).toMatchObject({ code: '23505', constraint_name: 'payment_requests_one_per_milestone' });

    await app(
      `update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2, updated_at = now()
        where id = $1`,
      [first, ownerId],
    );
    const again = await seedRequest(orgId, contract.contractId, ownerId, { milestoneId });
    const numbers = await ownerQuery<{ id: string; number: number }>(
      `select id, number from public.payment_requests where id = any($1::uuid[])`,
      [[first, again]],
    );
    expect(new Set(numbers.map((row) => row.number)).size).toBe(2);
    // A different milestone of the same contract is its own slot.
    await expect(seedRequest(orgId, contract.contractId, ownerId, { milestoneId: otherMilestoneId })).resolves.toBeTruthy();
  });

  it('holds ONE live request per change order, and ONE live final account per contract', async () => {
    const variation = await seedVariation(orgId, contract, 'approved');
    await seedRequest(orgId, contract.contractId, ownerId, { variationOrderId: variation.id });
    expect(
      await insertRequest(contract.contractId, { kind: 'variation', variation_order_id: variation.id }).catch(
        (caught: { constraint_name?: string }) => caught.constraint_name,
      ),
    ).toBe('payment_requests_one_per_variation');

    await seedRequest(orgId, contract.contractId, ownerId);
    expect(
      await insertRequest(contract.contractId, { kind: 'final_account' }).catch(
        (caught: { constraint_name?: string }) => caught.constraint_name,
      ),
    ).toBe('payment_requests_one_final_account');
  });

  it("refuses another contract's milestone or change order, same org (the 3-column FKs, 23503)", async () => {
    const sibling = await seedExecutionContract(orgId, { state: 'draft' });
    const siblingMilestone = await seedMilestone(orgId, sibling.contractId, 0);
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [sibling.contractId]);
    const siblingVariation = await seedVariation(orgId, sibling, 'approved');
    const milestoneError = await insertRequest(contract.contractId, {
      kind: 'milestone',
      milestone_id: siblingMilestone,
    }).catch((caught: { code?: string; constraint_name?: string }) => caught);
    expect(milestoneError).toMatchObject({
      code: '23503',
      constraint_name: 'payment_requests_milestone_same_contract_fk',
    });
    const variationError = await insertRequest(contract.contractId, {
      kind: 'variation',
      variation_order_id: siblingVariation.id,
    }).catch((caught: { code?: string; constraint_name?: string }) => caught);
    expect(variationError).toMatchObject({
      code: '23503',
      constraint_name: 'payment_requests_variationOrder_same_contract_fk',
    });
  });

  it("refuses a milestone of another org's contract (the 3-column FK, 23503)", async () => {
    const foreign = await seedExecutionContract(otherOrgId, { state: 'draft' });
    const foreignMilestone = await seedMilestone(otherOrgId, foreign.contractId, 0);
    expect(
      await sqlstate(insertRequest(contract.contractId, { kind: 'milestone', milestone_id: foreignMilestone })),
    ).toBe('23503');
  });
});

describe('payment_requests: the frozen trigger (AC16)', () => {
  let contract: ExecutionContract;

  beforeAll(async () => {
    contract = await seedExecutionContract(orgId, { state: 'signed' });
  });

  it('admits exactly issued -> void with voided_at and voided_by', async () => {
    const id = await seedRequest(orgId, contract.contractId, ownerId);
    await app(
      `update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2, updated_at = now()
        where id = $1`,
      [id, ownerId],
    );
    const [row] = await ownerQuery<{ status: string }>(`select status from public.payment_requests where id = $1`, [id]);
    expect(row.status).toBe('void');
  });

  it('raises MT100 on any other UPDATE of an issued or void request', async () => {
    const id = await seedRequest(orgId, contract.contractId, ownerId, {}, '700');
    for (const change of [
      `amount = 800`,
      `note = 'edited'`,
      `due_on = current_date + 30`,
      `updated_at = now()`,
      `status = 'void', voided_at = now(), voided_by = '${ownerId}', note = 'smuggled'`,
      `status = 'void', voided_at = now(), voided_by = '${ownerId}', amount = 1`,
    ]) {
      expect(
        await sqlstate(app(`update public.payment_requests set ${change} where id = $1`, [id])),
        change,
      ).toBe('MT100');
    }
    await app(
      `update public.payment_requests set status = 'void', voided_at = now(), voided_by = $2 where id = $1`,
      [id, ownerId],
    );
    expect(
      await sqlstate(
        app(`update public.payment_requests set status = 'issued', voided_at = null, voided_by = null where id = $1`, [id]),
      ),
    ).toBe('MT100');
    expect(await sqlstate(app(`update public.payment_requests set voided_at = now() where id = $1`, [id]))).toBe('MT100');
  });

  it('refuses DELETE twice: no grant for metra_app (42501), MT100 for the connection role', async () => {
    const id = await seedRequest(orgId, contract.contractId, ownerId);
    expect(await sqlstate(app(`delete from public.payment_requests where id = $1`, [id]))).toBe('42501');
    expect(await sqlstate(ownerQuery(`delete from public.payment_requests where id = $1`, [id]))).toBe('MT100');
  });
});

describe('contract_payments and contract_payment_claims (AC17, AC18 DB parts)', () => {
  let contract: ExecutionContract;
  let requestId: string;

  beforeAll(async () => {
    contract = await seedExecutionContract(orgId, { state: 'signed' });
    requestId = await seedRequest(orgId, contract.contractId, ownerId, {}, '500');
  });

  const pay = (fields: Record<string, unknown>) => {
    const row = {
      org_id: orgId,
      contract_id: contract.contractId,
      request_id: requestId,
      amount: '100',
      received_on: '2026-10-19',
      recorded_by: ownerId,
      ...fields,
    };
    const columns = Object.keys(row);
    return app(
      `insert into public.contract_payments (${columns.join(', ')})
       values (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
      Object.values(row),
    );
  };

  it('refuses a zero amount and over-long free text (23514)', async () => {
    expect(await sqlstate(pay({ amount: '0' }))).toBe('23514');
    // NaN is refused before the CHECK: the payment-fits guard reads it as more
    // than the request (NaN sorts above every number).
    expect(await sqlstate(pay({ amount: 'NaN' }))).toBe('MT131');
    expect(await sqlstate(pay({ method: 'm'.repeat(41) }))).toBe('23514');
    expect(await sqlstate(pay({ reference: 'r'.repeat(121) }))).toBe('23514');
    expect(await sqlstate(pay({ note: 'n'.repeat(501) }))).toBe('23514');
  });

  it('dedups a keyed payment per contract: ON CONFLICT DO NOTHING keeps ONE row', async () => {
    const key = randomUUID();
    const insertKeyed = () =>
      app(
        `insert into public.contract_payments
           (org_id, contract_id, request_id, amount, received_on, recorded_by, idempotency_key)
         values ($1, $2, $3, 50, '2026-10-19', $4, $5)
         on conflict (org_id, contract_id, idempotency_key) where idempotency_key is not null do nothing
         returning id`,
        [orgId, contract.contractId, requestId, ownerId, key],
      );
    expect(await insertKeyed()).toHaveLength(1);
    expect(await insertKeyed()).toHaveLength(0);
    const [count] = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from public.contract_payments where idempotency_key = $1`,
      [key],
    );
    expect(count.n).toBe(1);
  });

  it('is append-only for metra_app: UPDATE and DELETE are permission errors (42501)', async () => {
    const [payment] = await pay({});
    expect(
      await sqlstate(app(`update public.contract_payments set amount = 1 where id = $1`, [(payment as { id: string }).id])),
    ).toBe('42501');
    expect(
      await sqlstate(app(`delete from public.contract_payments where id = $1`, [(payment as { id: string }).id])),
    ).toBe('42501');
  });

  it("refuses a payment against another contract's request (the 3-column FK, 23503)", async () => {
    const sibling = await seedExecutionContract(orgId, { state: 'signed' });
    const siblingRequest = await seedRequest(orgId, sibling.contractId, ownerId);
    expect(await sqlstate(pay({ request_id: siblingRequest }))).toBe('23503');
  });

  it('holds ONE pending claim per request, and ties status to its resolution columns', async () => {
    const claim = (fields: Record<string, unknown> = {}) => {
      const row = {
        org_id: orgId,
        contract_id: contract.contractId,
        request_id: requestId,
        claimed_amount: '400',
        ...fields,
      };
      const columns = Object.keys(row);
      return app(
        `insert into public.contract_payment_claims (${columns.join(', ')})
         values (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
        Object.values(row),
      );
    };
    const [first] = (await claim()) as Array<{ id: string }>;
    expect(
      await claim().catch((caught: { constraint_name?: string }) => caught.constraint_name),
    ).toBe('contract_payment_claims_pending_request_unique');
    expect(await sqlstate(claim({ claimed_amount: '0' }))).toBe('23514');
    expect(await sqlstate(claim({ claimed_amount: 'NaN' }))).toBe('23514');
    expect(
      await sqlstate(app(`update public.contract_payment_claims set status = 'dismissed' where id = $1`, [first.id])),
    ).toBe('23514');
    expect(
      await sqlstate(
        app(
          `update public.contract_payment_claims set status = 'confirmed', resolved_at = now(), resolved_by = $2
            where id = $1`,
          [first.id, ownerId],
        ),
      ),
    ).toBe('23514');
    await app(
      `update public.contract_payment_claims set status = 'dismissed', resolved_at = now(), resolved_by = $2
        where id = $1`,
      [first.id, ownerId],
    );
    await expect(claim()).resolves.toHaveLength(1);
    expect(await sqlstate(app(`delete from public.contract_payment_claims where id = $1`, [first.id]))).toBe('42501');
  });
});

describe('contract_cost_entries (AC20, AC21, AC22 DB parts)', () => {
  let contract: ExecutionContract;
  let sibling: ExecutionContract;

  beforeAll(async () => {
    contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [2, 2] });
    sibling = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [1] });
  });

  const entry = (fields: Record<string, unknown>) => {
    const row = {
      org_id: orgId,
      contract_id: contract.contractId,
      category: 'materials',
      description: 'Cement',
      amount: '1000',
      incurred_on: '2026-10-19',
      recorded_by: ownerId,
      ...fields,
    };
    const columns = Object.keys(row);
    return app(
      `insert into public.contract_cost_entries (${columns.join(', ')})
       values (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
      Object.values(row),
    );
  };

  it('books to the whole contract, a section, or a line of that section', async () => {
    await expect(entry({})).resolves.toHaveLength(1);
    await expect(entry({ contract_section_id: contract.sectionIds[0] })).resolves.toHaveLength(1);
    await expect(
      entry({ contract_section_id: contract.sectionIds[0], contract_line_id: contract.lineIds[0][0] }),
    ).resolves.toHaveLength(1);
  });

  it('refuses the CHECK breaches with the constraint the core maps', async () => {
    for (const [fields, constraint] of [
      [{ amount: '0' }, 'contract_cost_entries_amount_positive'],
      [{ description: '   ' }, 'contract_cost_entries_description_present'],
      // F4: whitespace-only in every form a paste brings.
      [{ description: '\t\t' }, 'contract_cost_entries_description_present'],
      [{ description: '\r\n' }, 'contract_cost_entries_description_present'],
      [{ description: '\u00a0\u00a0' }, 'contract_cost_entries_description_present'],
      [{ description: ' \u3000\u200b\ufeff\u2028 ' }, 'contract_cost_entries_description_present'],
      // F3: NaN sorts above every number, so `> 0` alone would admit it.
      [{ amount: 'NaN' }, 'contract_cost_entries_amount_positive'],
      [{ qty: 'NaN', unit: 'sqm', unit_cost: '5' }, 'contract_cost_entries_qty_positive'],
      [{ qty: '1', unit: 'sqm', unit_cost: 'NaN' }, 'contract_cost_entries_unit_cost_nonneg'],
      [{ description: 'd'.repeat(301) }, 'contract_cost_entries_description_present'],
      [{ qty: '2', unit: 'sqm' }, 'contract_cost_entries_quantity_triple'],
      [{ unit_cost: '5' }, 'contract_cost_entries_quantity_triple'],
      [{ qty: '0', unit: 'sqm', unit_cost: '5' }, 'contract_cost_entries_qty_positive'],
      [{ qty: '1', unit: 'sqm', unit_cost: '-1' }, 'contract_cost_entries_unit_cost_nonneg'],
      [{ contract_line_id: contract.lineIds[0][0] }, 'contract_cost_entries_line_needs_section'],
      [{ supplier: 's'.repeat(121) }, 'contract_cost_entries_text_length'],
      [{ voided_at: '2026-10-19T10:00:00Z' }, 'contract_cost_entries_void_pair'],
    ] as const) {
      const error = await entry(fields).catch((caught: { code?: string; constraint_name?: string }) => caught);
      expect(error, constraint).toMatchObject({ code: '23514', constraint_name: constraint });
    }
  });

  it('keeps a description with one visible character among the spaces (Arabic too)', async () => {
    await expect(entry({ description: '\u00a0x\t' })).resolves.toHaveLength(1);
    await expect(entry({ description: '\u0623\u0633\u0645\u0646\u062a' })).resolves.toHaveLength(1);
  });

  it("refuses a line or a section of ANOTHER contract by the 3-column FKs (AC21, 23503)", async () => {
    const lineError = await entry({
      contract_section_id: sibling.sectionIds[0],
      contract_line_id: sibling.lineIds[0][0],
    }).catch((caught: { code?: string; constraint_name?: string }) => caught);
    expect(lineError).toMatchObject({ code: '23503' });
    const sectionError = await entry({ contract_section_id: sibling.sectionIds[0] }).catch(
      (caught: { code?: string; constraint_name?: string }) => caught,
    );
    expect(sectionError).toMatchObject({
      code: '23503',
      constraint_name: 'contract_cost_entries_contractSection_same_contract_fk',
    });
  });

  it('is voidable and editable but never deletable (42501)', async () => {
    const [row] = (await entry({})) as Array<{ id: string }>;
    await app(`update public.contract_cost_entries set amount = 1200 where id = $1`, [row.id]);
    await app(`update public.contract_cost_entries set voided_at = now(), voided_by = $2 where id = $1`, [
      row.id,
      ownerId,
    ]);
    expect(await sqlstate(app(`delete from public.contract_cost_entries where id = $1`, [row.id]))).toBe('42501');
  });

  it('keeps the entry and its org when the price-book item goes (SET NULL (cost_item_id), the 0052 rule)', async () => {
    const [section] = await ownerQuery<{ id: string }>(
      `select id from public.sections where org_id = $1 limit 1`,
      [orgId],
    );
    const [item] = await ownerQuery<{ id: string }>(
      `insert into public.cost_items (org_id, section_id, code, name_en, unit, default_unit_cost, default_unit_price)
       values ($1, $2, 'EXE-' || substr(md5(random()::text), 1, 6), 'Cement bag', 'pcs', 100, 120) returning id`,
      [orgId, section.id],
    );
    const [row] = (await entry({ cost_item_id: item.id })) as Array<{ id: string }>;
    await ownerQuery(`delete from public.cost_items where id = $1`, [item.id]);
    const [after] = await ownerQuery<{ cost_item_id: string | null; org_id: string }>(
      `select cost_item_id, org_id from public.contract_cost_entries where id = $1`,
      [row.id],
    );
    expect(after).toEqual({ cost_item_id: null, org_id: orgId });
  });
});

describe('contract_line_measurements (AC24 DB part)', () => {
  let contract: ExecutionContract;

  beforeAll(async () => {
    contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [2] });
  });

  const measure = (lineId: string, qty: string, measuredOn: string, contractId = contract.contractId) =>
    app(
      `insert into public.contract_line_measurements
         (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [orgId, contractId, lineId, qty, measuredOn, ownerId],
    );

  const latestOf = async (lineId: string) => {
    const [latest] = await app<{ measured_qty: string }>(
      `select measured_qty from public.contract_line_measurements
        where org_id = $1 and contract_line_id = $2
        order by seq desc limit 1`,
      [orgId, lineId],
    );
    return latest.measured_qty;
  };

  it('the latest RECORDED final reading wins (highest seq), whatever its measured_on', async () => {
    const lineId = contract.lineIds[0][0];
    await measure(lineId, '12', '2026-10-10');
    await measure(lineId, '9', '2026-10-01');
    expect(await latestOf(lineId)).toBe('9.0000');
  });

  it('orders two readings of ONE transaction as recorded (created_at ties; seq does not)', async () => {
    const lineId = contract.lineIds[0][1];
    const rows = await app<{ seq: number; created_at: Date }>(
      `insert into public.contract_line_measurements
         (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by)
       values ($1, $2, $3, 20, '2026-10-19', $4), ($1, $2, $3, 21, '2026-10-19', $4)
       returning seq, created_at`,
      [orgId, contract.contractId, lineId, ownerId],
    );
    expect(rows[0].created_at.getTime()).toBe(rows[1].created_at.getTime());
    expect(Number(rows[1].seq)).toBeGreaterThan(Number(rows[0].seq));
    expect(await latestOf(lineId)).toBe('21.0000');
  });

  it('refuses a hand-written seq (GENERATED ALWAYS, 428C9)', async () => {
    expect(
      await sqlstate(
        app(
          `insert into public.contract_line_measurements
             (org_id, contract_id, contract_line_id, seq, measured_qty, measured_on, recorded_by)
           values ($1, $2, $3, 999999999, 1, '2026-10-19', $4)`,
          [orgId, contract.contractId, contract.lineIds[0][1], ownerId],
        ),
      ),
    ).toBe('428C9');
  });

  it('refuses a chosen seq even with OVERRIDING SYSTEM VALUE: no INSERT on that column (S1, 42501)', async () => {
    expect(
      await sqlstate(
        app(
          `insert into public.contract_line_measurements
             (org_id, contract_id, contract_line_id, seq, measured_qty, measured_on, recorded_by)
           overriding system value
           values ($1, $2, $3, 999999999, 1, '2026-10-19', $4)`,
          [orgId, contract.contractId, contract.lineIds[0][1], ownerId],
        ),
      ),
    ).toBe('42501');
  });

  it('refuses a negative or NaN quantity (23514) and a line of another contract (23503)', async () => {
    expect(await sqlstate(measure(contract.lineIds[0][1], '-1', '2026-10-19'))).toBe('23514');
    expect(await sqlstate(measure(contract.lineIds[0][1], 'NaN', '2026-10-19'))).toBe('23514');
    const sibling = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [1] });
    expect(await sqlstate(measure(sibling.lineIds[0][0], '1', '2026-10-19'))).toBe('23503');
  });

  it('is append-only for metra_app: UPDATE and DELETE are permission errors (42501)', async () => {
    const [row] = (await measure(contract.lineIds[0][1], '3', '2026-10-19')) as Array<{ id: string }>;
    expect(
      await sqlstate(app(`update public.contract_line_measurements set measured_qty = 4 where id = $1`, [row.id])),
    ).toBe('42501');
    expect(await sqlstate(app(`delete from public.contract_line_measurements where id = $1`, [row.id]))).toBe('42501');
  });
});

describe('grants: exactly what roles.sql leaves metra_app with', () => {
  it('matches the privilege matrix of the six tables', async () => {
    const rows = await ownerQuery<{ table_name: string; privileges: string }>(
      `select t as table_name,
              concat_ws(',',
                case when has_table_privilege('metra_app', 'public.' || t, 'select') then 'S' end,
                case when has_table_privilege('metra_app', 'public.' || t, 'insert') then 'I' end,
                case when has_table_privilege('metra_app', 'public.' || t, 'update') then 'U' end,
                case when has_table_privilege('metra_app', 'public.' || t, 'delete') then 'D' end) as privileges
         from unnest(array['contract_payment_milestones', 'payment_requests', 'contract_payments',
                           'contract_payment_claims', 'contract_cost_entries', 'contract_line_measurements']) as t
        order by 1`,
    );
    expect(Object.fromEntries(rows.map((row) => [row.table_name, row.privileges]))).toEqual({
      contract_cost_entries: 'S,I,U',
      // INSERT is column-level (every column but seq), so not a table privilege.
      contract_line_measurements: 'S',
      contract_payment_claims: 'S,I,U',
      contract_payment_milestones: 'S,I,U,D',
      contract_payments: 'S,I',
      payment_requests: 'S,I,U',
    });
  });
});

describe('privileges metra_app never holds (S4)', () => {
  it('has no TRUNCATE, REFERENCES or TRIGGER on any table, and may insert every measurement column but seq', async () => {
    const [hidden] = await ownerQuery<{ n: number }>(
      `select count(*)::int as n
         from pg_class c cross join (values ('truncate'), ('references'), ('trigger')) as p(name)
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and has_table_privilege('metra_app', c.oid, p.name)`,
    );
    expect(hidden.n).toBe(0);
    const columns = await ownerQuery<{ name: string; granted: boolean }>(
      `select a.attname as name, has_column_privilege('metra_app', a.attrelid, a.attnum, 'insert') as granted
         from pg_attribute a
        where a.attrelid = 'public.contract_line_measurements'::regclass and a.attnum > 0 and not a.attisdropped`,
    );
    expect(columns.filter((column) => column.granted !== (column.name !== 'seq'))).toEqual([]);
  });

  it('converges a hand-granted TRUNCATE on a Stage 2 table when roles.sql runs again (revoke all)', async () => {
    await ownerQuery(`grant truncate on public.contract_payments to metra_app`);
    const roles = readFileSync(resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../packages/db/src/rls/roles.sql'), 'utf8');
    await ownerQuery(roles);
    const [after] = await ownerQuery<{ held: boolean }>(
      `select has_table_privilege('metra_app', 'public.contract_payments', 'truncate') as held`,
    );
    expect(after.held).toBe(false);
  });
});

describe('contract_lines: the 3-column section FK (S3)', () => {
  it("refuses a line in a section of ANOTHER contract of the same studio (23503)", async () => {
    const first = await seedExecutionContract(orgId, { state: 'draft', linesPerSection: [1] });
    const second = await seedExecutionContract(orgId, { state: 'draft', linesPerSection: [1] });
    const error = await ownerQuery(
      `insert into public.contract_lines (org_id, contract_id, section_id, description_en, qty, unit, unit_price)
       values ($1, $2, $3, 'Stray', 1, 'sqm', 1)`,
      [orgId, first.contractId, second.sectionIds[0]],
    ).catch((caught: { code?: string; constraint_name?: string }) => caught);
    expect(error).toMatchObject({ code: '23503', constraint_name: 'contract_lines_section_same_contract_fk' });
  });
});

describe('org isolation with real rows in all six tables', () => {
  let foreign: ExecutionContract;

  beforeAll(async () => {
    foreign = await seedExecutionContract(otherOrgId, { state: 'draft', linesPerSection: [1] });
    await seedMilestone(otherOrgId, foreign.contractId, 0);
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [foreign.contractId]);
    await ownerQuery(`update public.contracts set status = 'signed' where id = $1`, [foreign.contractId]);
    const requestId = await seedRequest(otherOrgId, foreign.contractId, otherOwnerId);
    await ownerQuery(
      `insert into public.contract_payments (org_id, contract_id, request_id, amount, received_on, recorded_by)
       values ($1, $2, $3, 10, current_date, $4)`,
      [otherOrgId, foreign.contractId, requestId, otherOwnerId],
    );
    await ownerQuery(
      `insert into public.contract_payment_claims (org_id, contract_id, request_id, claimed_amount)
       values ($1, $2, $3, 10)`,
      [otherOrgId, foreign.contractId, requestId],
    );
    await ownerQuery(
      `insert into public.contract_cost_entries (org_id, contract_id, category, description, amount, incurred_on, recorded_by)
       values ($1, $2, 'labour', 'Crew', 10, current_date, $3)`,
      [otherOrgId, foreign.contractId, otherOwnerId],
    );
    await ownerQuery(
      `insert into public.contract_line_measurements (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by)
       values ($1, $2, $3, 1, current_date, $4)`,
      [otherOrgId, foreign.contractId, foreign.lineIds[0][0], otherOwnerId],
    );
  });

  const TABLES = [
    'contract_payment_milestones',
    'payment_requests',
    'contract_payments',
    'contract_payment_claims',
    'contract_cost_entries',
    'contract_line_measurements',
  ];

  it("its own member sees the rows; org A's member sees none of them", async () => {
    for (const table of TABLES) {
      const [own] = await appQuery<{ n: number }>(
        otherOrgId,
        otherOwnerId,
        `select count(*)::int as n from public.${table} where org_id = $1`,
        [otherOrgId],
      );
      expect(own.n, `${table}: the owning org reads its row`).toBeGreaterThan(0);
      const [leaked] = await app(`select count(*)::int as n from public.${table} where org_id = $1`, [otherOrgId]);
      expect((leaked as { n: number }).n, `${table} leaked across orgs`).toBe(0);
    }
  });

  it('a forged context (org B named, a non-member user) sees nothing and writes nothing', async () => {
    for (const table of TABLES) {
      const [seen] = await appQuery<{ n: number }>(otherOrgId, ownerId, `select count(*)::int as n from public.${table}`);
      expect(seen.n, `${table} visible to a non-member`).toBe(0);
    }
    expect(
      await sqlstate(
        appQuery(
          otherOrgId,
          ownerId,
          `insert into public.contract_cost_entries (org_id, contract_id, category, description, amount, incurred_on, recorded_by)
           values ($1, $2, 'labour', 'Forged', 10, current_date, $3)`,
          [otherOrgId, foreign.contractId, ownerId],
        ),
      ),
    ).toBe('42501');
  });

  it("a payment into another studio's request at an over-amount answers 42501, never MT131 (S5)", async () => {
    // The payment-fits guard runs as the CALLER: org B's request is invisible
    // to org A's member, so the guard learns nothing and says nothing, and the
    // insert's own policy refuses the row.
    const theirs = await seedExecutionContract(otherOrgId, { state: 'signed', linesPerSection: [1] });
    const theirRequest = await seedRequest(otherOrgId, theirs.contractId, otherOwnerId, {}, '100');
    expect(
      await sqlstate(
        app(
          `insert into public.contract_payments (org_id, contract_id, request_id, amount, received_on, recorded_by)
           values ($1, $2, $3, 1000000, current_date, $4)`,
          [otherOrgId, theirs.contractId, theirRequest, ownerId],
        ),
      ),
    ).toBe('42501');
    // Under org A's own org_id the row passes the policy and meets the
    // 3-column FK instead: still nothing about B's request.
    expect(
      await sqlstate(
        app(
          `insert into public.contract_payments (org_id, contract_id, request_id, amount, received_on, recorded_by)
           values ($1, $2, $3, 1000000, current_date, $4)`,
          [orgId, theirs.contractId, theirRequest, ownerId],
        ),
      ),
    ).toBe('23503');
    // And the same over-amount on org A's OWN request is MT131: the guard works under RLS.
    const mine = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [1] });
    const myRequest = await seedRequest(orgId, mine.contractId, ownerId, {}, '100');
    expect(
      await sqlstate(
        app(
          `insert into public.contract_payments (org_id, contract_id, request_id, amount, received_on, recorded_by)
           values ($1, $2, $3, 1000000, current_date, $4)`,
          [orgId, mine.contractId, myRequest, ownerId],
        ),
      ),
    ).toBe('MT131');
  });

  it("org A cannot write a row naming org B's contract under its own org_id (23503)", async () => {
    expect(
      await sqlstate(
        app(
          `insert into public.contract_cost_entries (org_id, contract_id, category, description, amount, incurred_on, recorded_by)
           values ($1, $2, 'labour', 'Cross', 10, current_date, $3)`,
          [orgId, foreign.contractId, ownerId],
        ),
      ),
    ).toBe('23503');
  });
});
