import { randomUUID } from 'node:crypto';
import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { recordMeasurementCore } from '@/lib/execution/measurements/core';
import { loadMeasurementsCore } from '@/lib/execution/measurements/read-core';
import { voidPaymentRequestCore } from '@/lib/execution/requests/void';
import { seedOrderWithLines } from './execution-final-account-fixture';
import { appQuery, closeExecutionFixture, ownerQuery, seedExecutionContract, seedRequest, sqlstate, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A5.1: the FINAL measured quantity of a line (owner decision Oct 19).
// AC24 (the latest RECORDED reading wins, append-only by grant), AC25 (no
// reading once the final account is issued, and again once it is voided),
// the refusals, the keyed replay, and the bounded tab read.

const orgIds: string[] = [];
let orgId: string;
const ctx: Partial<Record<MemberRole, OrgContext>> = {};
const ROLES: MemberRole[] = ['admin', 'project_manager', 'site_engineer', 'accountant', 'viewer'];
const TODAY = todayInCairo(new Date());

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: ROLES.map((role) => ({ role })) });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  ctx.owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  ROLES.forEach((role, index) => (ctx[role] = ctxFor(orgId, seeded.memberIds[index], role)));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const reading = (contractId: string, contractLineId: string, measuredQty = '12', extra: Record<string, unknown> = {}) => ({
  contractId, contractLineId, measuredQty, measuredOn: TODAY, idempotencyKey: randomUUID(), ...extra,
});

const view = async (contractId: string, extra: Record<string, unknown> = {}) => {
  const res = await loadMeasurementsCore(ctx.owner!, { contractId, afterLineId: null, provisionalOnly: false, query: '', ...extra });
  if (!res.ok || !res.data) throw new Error(`read failed: ${JSON.stringify(res)}`);
  return res.data;
};

describe('recordMeasurementCore', () => {
  it('records the reading for the site engineer and the PM, and refuses the accountant and the viewer', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const line = contract.lineIds[0][0];
    for (const role of ['site_engineer', 'project_manager'] as const) {
      expect(await recordMeasurementCore(ctx[role]!, reading(contract.contractId, line))).toMatchObject({ ok: true, already: false });
    }
    for (const role of ['accountant', 'viewer'] as const) {
      expect(await recordMeasurementCore(ctx[role]!, reading(contract.contractId, line))).toEqual({ ok: false, error: 'forbidden' });
    }
    const rows = await ownerQuery<{ by: string }>(
      `select recorded_by::text as by from public.contract_line_measurements where contract_line_id = $1 order by seq`,
      [line],
    );
    expect(rows.map((row) => row.by)).toEqual([ctx.site_engineer!.userId, ctx.project_manager!.userId]);
  });

  it('AC24: the later RECORDED reading is the final quantity, even with an earlier day, and inside one statement', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const [first, second] = contract.lineIds[0];
    await tamper(`update public.contracts set created_at = now() - interval '10 days' where id = $1`, [contract.contractId]);
    expect((await recordMeasurementCore(ctx.owner!, reading(contract.contractId, first, '10'))).ok).toBe(true);
    const yesterday = new Date(Date.parse(`${TODAY}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect((await recordMeasurementCore(ctx.owner!, reading(contract.contractId, first, '7.5', { measuredOn: yesterday }))).ok).toBe(true);
    await ownerQuery(
      `insert into public.contract_line_measurements (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by)
       values ($1, $2, $3, 4, current_date, $4), ($1, $2, $3, 5, current_date - 3, $4)`,
      [orgId, contract.contractId, second, ctx.owner!.userId],
    );
    const lines = (await view(contract.contractId)).page.lines;
    expect(lines[0].latest).toEqual({ measuredQty: '7.5000', measuredOn: yesterday, note: null });
    expect(lines[1].latest?.measuredQty).toBe('5.0000');
    expect(lines[2].latest).toBeNull();
  });

  it('AC24: the ledger is append-only for metra_app (UPDATE and DELETE denied)', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    await recordMeasurementCore(ctx.owner!, reading(contract.contractId, contract.lineIds[0][0]));
    for (const statement of ['update public.contract_line_measurements set measured_qty = 1', 'delete from public.contract_line_measurements']) {
      expect(await sqlstate(appQuery(orgId, ctx.owner!.userId, `${statement} where contract_id = '${contract.contractId}'`))).toBe('42501');
    }
  });

  it('AC25: refuses once the final account is issued, and records again once it is voided', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const line = contract.lineIds[0][1];
    const finalAccount = await seedRequest(orgId, contract.contractId, ctx.owner!.userId);
    expect(await recordMeasurementCore(ctx.owner!, reading(contract.contractId, line))).toEqual({ ok: false, error: 'final_account_issued' });
    expect((await view(contract.contractId)).contract.finalAccountIssued).toBe(true);
    expect(await voidPaymentRequestCore(ctx.owner!, { requestId: finalAccount, reason: 'Recount' })).toEqual({ ok: true });
    expect(await recordMeasurementCore(ctx.owner!, reading(contract.contractId, line))).toMatchObject({ ok: true });
  });

  it('refuses a line of another contract, an unsigned, a terminated and a proposal contract', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const other = await seedExecutionContract(orgId, { state: 'signed' });
    expect(await recordMeasurementCore(ctx.owner!, reading(contract.contractId, other.lineIds[0][0]))).toEqual({ ok: false, error: 'line_not_in_contract' });
    for (const state of ['draft', 'issued'] as const) {
      const unsigned = await seedExecutionContract(orgId, { state });
      expect(await recordMeasurementCore(ctx.owner!, reading(unsigned.contractId, unsigned.lineIds[0][0]))).toEqual({ ok: false, error: 'contract_not_signed' });
    }
    const ended = await seedExecutionContract(orgId, { state: 'signed' });
    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [ended.contractId]);
    expect(await recordMeasurementCore(ctx.owner!, reading(ended.contractId, ended.lineIds[0][0]))).toEqual({ ok: false, error: 'contract_not_active' });
    expect(await recordMeasurementCore(ctx.owner!, reading(randomUUID(), contract.lineIds[0][0]))).toEqual({ ok: false, error: 'record_not_found' });
  });

  it('refuses every wrong box at once, a day before the issue day, and a malformed payload', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const line = contract.lineIds[0][0];
    expect(await recordMeasurementCore(ctx.owner!, reading(contract.contractId, line, '-1', { measuredOn: '2999-01-01' }))).toEqual({
      ok: false, error: 'check_fields', fields: { measuredQty: { code: 'not_negative' }, measuredOn: { code: 'date_in_future' } },
    });
    const res = await recordMeasurementCore(ctx.owner!, reading(contract.contractId, line, '1', { measuredOn: '2001-01-01' }));
    expect(res).toMatchObject({ ok: false, error: 'check_fields', fields: { measuredOn: { code: 'date_before_issue' } } });
    for (const input of [null, 'x', { ...reading(contract.contractId, line), idempotencyKey: 'nope' }, { ...reading(contract.contractId, line), contractLineId: 7 }]) {
      expect(await recordMeasurementCore(ctx.owner!, input as never)).toEqual({ ok: false, error: 'malformed' });
    }
  });

  it('a replayed key answers that reading (already), a key reused for another reading is a conflict', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const input = reading(contract.contractId, contract.lineIds[0][0], '3');
    const first = await recordMeasurementCore(ctx.owner!, input);
    const again = await recordMeasurementCore(ctx.site_engineer!, { ...input, idempotencyKey: input.idempotencyKey.toUpperCase() });
    expect(again).toEqual({ ok: true, data: first.data, already: true });
    expect(await recordMeasurementCore(ctx.owner!, { ...input, measuredQty: '4' })).toEqual({ ok: false, error: 'idempotency_conflict' });
    const [count] = await ownerQuery<{ n: number }>(`select count(*)::int as n from public.contract_line_measurements where contract_id = $1`, [contract.contractId]);
    expect(count.n).toBe(1);
    const raced = { ...input, idempotencyKey: randomUUID() };
    const both = await Promise.all([1, 2].map(() => recordMeasurementCore(ctx.owner!, raced)));
    expect(both.filter((res) => res.ok && res.already).length).toBe(1);
  });
});

describe('loadMeasurementsCore', () => {
  it('pages the lines 50 at a time in document order, with no price, filtered and searched', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed', linesPerSection: [40, 30] });
    await seedOrderWithLines(orgId, contract, [{ contractLineId: contract.lineIds[0][0], qty: '4' }]);
    const first = await view(contract.contractId);
    expect(first.page.lines).toHaveLength(50);
    expect(first.page.lines[0]).toMatchObject({ id: contract.lineIds[0][0], qty: '1.0000', variationQty: '4.0000', sectionTitleEn: 'Section 1' });
    expect(Object.keys(first.page.lines[0]).some((key) => /price|total|cost|margin/i.test(key))).toBe(false);
    const second = await view(contract.contractId, { afterLineId: first.page.nextCursor });
    expect(second.page.lines.map((line) => line.id)).toEqual(contract.lineIds[1].slice(10));
    expect(second.page.nextCursor).toBeNull();
    const provisional = await view(contract.contractId, { provisionalOnly: true });
    expect(provisional.page.lines.every((line) => line.provisional)).toBe(true);
    expect(provisional.page.lines).toHaveLength(14);
    expect((await view(contract.contractId, { query: 'line 33' })).page.lines.map((line) => line.id)).toEqual([contract.lineIds[0][32]]);
  });

  it('answers record_not_found for another org\'s contract or a foreign cursor, and forbidden for the client role', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const outsider = await seedOrg({ owners: 1 });
    orgIds.push(outsider.orgId);
    const stranger = ctxFor(outsider.orgId, outsider.ownerIds[0], 'owner');
    const request = { contractId: contract.contractId, afterLineId: null, provisionalOnly: false, query: '' };
    expect(await loadMeasurementsCore(stranger, request)).toEqual({ ok: false, error: 'record_not_found' });
    expect(await loadMeasurementsCore(ctx.owner!, { ...request, afterLineId: randomUUID() })).toEqual({ ok: false, error: 'record_not_found' });
    expect(await loadMeasurementsCore({ ...ctx.owner!, role: 'client' }, request)).toEqual({ ok: false, error: 'forbidden' });
    expect(await loadMeasurementsCore(ctx.owner!, { ...request, provisionalOnly: 'yes' })).toEqual({ ok: false, error: 'malformed' });
  });
});
