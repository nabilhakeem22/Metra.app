import type { MemberRole } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import { issueMilestoneRequestCore } from '@/lib/execution/requests/issue-milestone';
import { issueVariationRequestCore } from '@/lib/execution/requests/issue-variation';
import { requestCount, requestRow, seedBillableContract } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery, seedRequest, seedVariation } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A4.1: sending payment requests (مطالبة دفع). AC13, AC14, AC19 (billing),
// the over-balance warning that does not block (A4.1 addendum), and
// final_account_issued (AC28, the send half). The void core is in
// execution-requests-void.dbtest.ts.

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

describe('issueMilestoneRequestCore', () => {
  it('bills the signed row with its VAT, today, under the next PR number, with the due day and note', async () => {
    const contract = await seedBillableContract(orgId);
    const res = await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0], dueOn: '2999-01-31', note: 'Advance' });
    expect(res).toMatchObject({ ok: true });
    expect(res.balanceWarning).toBeUndefined();
    expect(await requestRow(res.data!)).toMatchObject({
      kind: 'milestone',
      status: 'issued',
      amount: '62000.0000',
      tax_amount: '7000.0000',
      issued_on: TODAY,
      due_on: '2999-01-31',
      note: 'Advance',
      issued_by: ctx.owner!.userId,
    });
    const second = await issueMilestoneRequestCore(ctx.accountant!, { milestoneId: contract.milestoneIds[1] });
    expect((await requestRow(second.data!)).number).toBe((await requestRow(res.data!)).number + 1);
    const [audit] = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from public.audit_log where entity = 'payment_request' and entity_id = $1 and action = 'issue'`,
      [res.data],
    );
    expect(audit.n).toBe(1);
  });

  it('refuses an unsigned contract (AC13), a terminated one, and a role without invoices_issue', async () => {
    for (const state of ['draft', 'issued'] as const) {
      const contract = await seedBillableContract(orgId, state);
      expect(await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0] })).toEqual({ ok: false, error: 'contract_not_signed' });
    }
    const ended = await seedBillableContract(orgId);
    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [ended.contractId]);
    expect(await issueMilestoneRequestCore(ctx.owner!, { milestoneId: ended.milestoneIds[0] })).toEqual({ ok: false, error: 'contract_not_active' });
    const contract = await seedBillableContract(orgId);
    for (const role of ['project_manager', 'site_engineer', 'viewer'] as const) {
      expect(await issueMilestoneRequestCore(ctx[role]!, { milestoneId: contract.milestoneIds[0] })).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(await requestCount(contract.contractId)).toBe(0);
  });

  it('two concurrent sends of one row create one request; the loser is request_exists (AC14)', async () => {
    const contract = await seedBillableContract(orgId);
    const results = await Promise.all(
      [ctx.owner!, ctx.admin!, ctx.accountant!].map((member) => issueMilestoneRequestCore(member, { milestoneId: contract.milestoneIds[0] })),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: 'request_exists' },
      { ok: false, error: 'request_exists' },
    ]);
    expect(await requestCount(contract.contractId)).toBe(1);
  });

  it('warns, and still sends, when the row bills more than is left to bill (A4.1 addendum)', async () => {
    const contract = await seedBillableContract(orgId);
    // A de-scope of 10,000 works lowers the contract by 12,400 (VAT and supervision follow it).
    await seedVariation(orgId, contract, 'approved', { netDelta: '-10000' });
    for (const index of [0, 1]) await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[index] });
    const last = await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[2] });
    expect(last).toMatchObject({ ok: true, balanceWarning: { balance: '12400.0000' } });
    expect((await requestRow(last.data!)).amount).toBe('24800.0000');
  });

  it('refuses any request once the final account is issued (final_account_issued)', async () => {
    const contract = await seedBillableContract(orgId);
    await seedRequest(orgId, contract.contractId, ctx.owner!.userId);
    expect(await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0] })).toEqual({ ok: false, error: 'final_account_issued' });
    const order = await seedVariation(orgId, contract, 'approved');
    expect(await issueVariationRequestCore(ctx.owner!, { variationOrderId: order.id })).toEqual({ ok: false, error: 'final_account_issued' });
  });

  it('says a past or impossible due day and an over-long note under their boxes; a bad payload is malformed', async () => {
    const contract = await seedBillableContract(orgId);
    expect(
      await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0], dueOn: '2001-01-01', note: 'x'.repeat(501) }),
    ).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { dueOn: { code: 'date_in_past' }, note: { code: 'too_long', params: { max: 500 } } },
    });
    expect(await issueMilestoneRequestCore(ctx.owner!, { milestoneId: contract.milestoneIds[0], dueOn: '2026-02-30' })).toMatchObject({
      fields: { dueOn: { code: 'invalid_date' } },
    });
    const call = issueMilestoneRequestCore as (ctx: OrgContext, input: unknown) => ReturnType<typeof issueMilestoneRequestCore>;
    for (const payload of [null, 'x', { milestoneId: 'nope' }]) {
      expect(await call(ctx.owner!, payload)).toEqual({ ok: false, error: 'malformed' });
    }
    expect(await issueMilestoneRequestCore(ctx.owner!, { milestoneId: '00000000-0000-4000-8000-000000000000' })).toEqual({
      ok: false,
      error: 'record_not_found',
    });
    expect(await requestCount(contract.contractId)).toBe(0);
  });

  it("does not find another studio's milestone", async () => {
    const other = await seedOrg({ owners: 1 });
    orgIds.push(other.orgId);
    const foreign = await seedBillableContract(other.orgId);
    expect(await issueMilestoneRequestCore(ctx.owner!, { milestoneId: foreign.milestoneIds[0] })).toEqual({
      ok: false,
      error: 'record_not_found',
    });
    expect(await requestCount(foreign.contractId)).toBe(0);
  });
});

describe('issueVariationRequestCore (AC19, the billing part)', () => {
  it('bills an approved order of net 10,000 at 12,400.0000 with VAT 1,400.0000 (tax 14, supervision 10, D4a)', async () => {
    const contract = await seedBillableContract(orgId);
    const order = await seedVariation(orgId, contract, 'approved', { netDelta: '10000' });
    const res = await issueVariationRequestCore(ctx.owner!, { variationOrderId: order.id });
    expect(res).toMatchObject({ ok: true });
    expect(await requestRow(res.data!)).toMatchObject({ kind: 'variation', amount: '12400.0000', tax_amount: '1400.0000' });
    expect(await issueVariationRequestCore(ctx.admin!, { variationOrderId: order.id })).toEqual({ ok: false, error: 'request_exists' });
  });

  it('refuses a de-scope (variation_credit_not_billable) and an order the client has not approved', async () => {
    const contract = await seedBillableContract(orgId);
    const credit = await seedVariation(orgId, contract, 'approved', { netDelta: '-500' });
    expect(await issueVariationRequestCore(ctx.owner!, { variationOrderId: credit.id })).toEqual({
      ok: false,
      error: 'variation_credit_not_billable',
    });
    for (const status of ['draft', 'internal_approved', 'issued', 'rejected'] as const) {
      const order = await seedVariation(orgId, contract, status);
      expect(await issueVariationRequestCore(ctx.owner!, { variationOrderId: order.id }), status).toEqual({
        ok: false,
        error: 'variation_not_approved',
      });
    }
    expect(await requestCount(contract.contractId)).toBe(0);
  });

  it('two concurrent sends of one order create one request (request_exists)', async () => {
    const contract = await seedBillableContract(orgId);
    const order = await seedVariation(orgId, contract, 'approved');
    const results = await Promise.all([ctx.owner!, ctx.admin!].map((member) => issueVariationRequestCore(member, { variationOrderId: order.id })));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, error: 'request_exists' });
  });
});
