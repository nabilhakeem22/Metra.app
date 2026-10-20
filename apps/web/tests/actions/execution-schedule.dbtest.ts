import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateExecutionContractCore, issueContractCore, setContractChargesCore } from '@/lib/contracts/core';
import { saveContractScheduleCore } from '@/lib/contracts/schedule/save';
import { getContractSchedule } from '@/lib/contracts/schedule/queries';
import type { OrgContext } from '@/lib/db/context';
import { seedBoq, seedProposalContract } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A3.2: the payment schedule (AC5, AC6), the issue gate (AC7) and the
// lock-order addendum (Oct 20): concurrent saves, and a save racing an issue,
// never deadlock (40P01) and never leave a schedule the gate did not see.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const row = (value: string, basis: 'percent' | 'amount' = 'percent', labelEn = 'Payment') => ({
  labelAr: null,
  labelEn,
  basis,
  value,
});
const SPLIT_50_30_20 = [row('50', 'percent', 'Advance'), row('30', 'percent', 'Works'), row('20', 'percent', 'Handover')];

async function draftContract(total = '100000'): Promise<string> {
  const boq = await seedBoq(orgId, { total });
  return (await generateExecutionContractCore(owner, { boqId: boq.boqId, taxRate: '0', supervisionPct: '0' })).data!;
}

const storedRows = (contractId: string) =>
  ownerQuery<{ label_en: string; basis: string; value: string; sort_order: number }>(
    `select label_en, basis, value::text, sort_order from public.contract_payment_milestones
      where contract_id = $1 order by sort_order`,
    [contractId],
  );

describe('AC5 and AC6: saving the schedule', () => {
  it('50/30/20 on 100,000.0001 bills amounts that sum exactly to it, the last row taking the remainder', async () => {
    const contractId = await draftContract('100000.0001');
    expect(await saveContractScheduleCore(owner, { contractId, milestones: SPLIT_50_30_20 })).toEqual({ ok: true, data: undefined });
    const view = await getContractSchedule(owner, { id: contractId, originalValue: '100000.0001', taxAmount: '0' });
    expect(view.valid).toBe(true);
    expect(view.rows.map((stored) => stored.amount)).toEqual(['50000.0001', '30000.0000', '20000.0000']);
  });

  it('50/30 is schedule_sum_mismatch (expected 100, actual 80); a mixed basis is refused under milestones', async () => {
    const contractId = await draftContract();
    expect(await saveContractScheduleCore(owner, { contractId, milestones: [row('50'), row('30')] })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { milestones: { code: 'schedule_sum_mismatch', params: { expected: '100', actual: '80' } } },
    });
    expect(await saveContractScheduleCore(owner, { contractId, milestones: [row('50'), row('50000', 'amount')] })).toMatchObject({
      error: 'check_fields',
      fields: { milestones: { code: 'contract_schedule_invalid' } },
    });
    expect(await storedRows(contractId)).toEqual([]);
  });

  it('refuses 13 rows, a row with no label and a row that is not a number, each under its box', async () => {
    const contractId = await draftContract();
    const thirteen = Array.from({ length: 13 }, () => row('1'));
    expect(await saveContractScheduleCore(owner, { contractId, milestones: thirteen })).toMatchObject({
      fields: { milestones: { code: 'schedule_too_long' } },
    });
    const bad = await saveContractScheduleCore(owner, {
      contractId,
      milestones: [{ ...row('50'), labelEn: ' ' }, row('fifty')],
    });
    expect(bad).toMatchObject({
      error: 'check_fields',
      fields: { 'milestones.0.label': { code: 'required' }, 'milestones.1.value': { code: 'not_a_number' } },
    });
    expect(await saveContractScheduleCore(owner, { contractId, milestones: 'all of it' })).toMatchObject({
      fields: { milestones: { code: 'required' } },
    });
  });

  it('replaces the whole schedule; refuses an issued contract and a proposal contract', async () => {
    const contractId = await draftContract();
    await saveContractScheduleCore(owner, { contractId, milestones: SPLIT_50_30_20 });
    await saveContractScheduleCore(owner, { contractId, milestones: [row('60000', 'amount'), row('40000', 'amount')] });
    expect(await storedRows(contractId)).toEqual([
      { label_en: 'Payment', basis: 'amount', value: '60000.0000', sort_order: 0 },
      { label_en: 'Payment', basis: 'amount', value: '40000.0000', sort_order: 1 },
    ]);
    const issued = await seedExecutionContract(orgId, { state: 'issued' });
    expect(await saveContractScheduleCore(owner, { contractId: issued.contractId, milestones: SPLIT_50_30_20 })).toEqual({
      ok: false,
      error: 'contract_not_draft',
    });
    const proposalContractId = await seedProposalContract(orgId);
    expect(await saveContractScheduleCore(owner, { contractId: proposalContractId, milestones: SPLIT_50_30_20 })).toEqual({
      ok: false,
      error: 'contract_not_execution',
    });
  });
});

async function issueTrail(contractId: string) {
  const [trail] = await ownerQuery<{ status: string; token: boolean; events: number }>(
    `select c.status, c.token_hash is not null as token,
            (select count(*) from public.contract_events e where e.contract_id = c.id)::int as events
       from public.contracts c where c.id = $1`,
    [contractId],
  );
  return trail;
}

describe('AC7: the issue gate', () => {
  it('refuses a BOQ contract with no schedule, writing no token and no event', async () => {
    const contractId = await draftContract();
    expect(await issueContractCore(owner, { id: contractId })).toEqual({ ok: false, error: 'contract_schedule_missing' });
    expect(await issueTrail(contractId)).toEqual({ status: 'draft', token: false, events: 0 });
  });

  it('refuses an amount schedule the charges moved the value under, until it is saved again', async () => {
    const contractId = await draftContract();
    await saveContractScheduleCore(owner, { contractId, milestones: [row('100000', 'amount')] });
    await setContractChargesCore(owner, { contractId, taxRate: '14', supervisionPct: '0' });
    expect(await issueContractCore(owner, { id: contractId })).toEqual({ ok: false, error: 'contract_schedule_invalid' });
    await saveContractScheduleCore(owner, { contractId, milestones: [row('114000', 'amount')] });
    const issued = await issueContractCore(owner, { id: contractId });
    expect(issued).toMatchObject({ ok: true, data: expect.stringMatching(/.{20,}/) });
    expect(await issueTrail(contractId)).toEqual({ status: 'issued', token: true, events: 1 });
  });

  it('issues a proposal contract with no schedule, as before', async () => {
    const proposalContractId = await seedProposalContract(orgId);
    expect(await issueContractCore(owner, { id: proposalContractId })).toMatchObject({ ok: true });
  });
});

describe('lock order (addendum Oct 20): no deadlock, no unseen schedule', () => {
  it('two concurrent saves both land, one after the other', async () => {
    for (let run = 0; run < 5; run += 1) {
      const contractId = await draftContract();
      const results = await Promise.all([
        saveContractScheduleCore(owner, { contractId, milestones: SPLIT_50_30_20 }),
        saveContractScheduleCore(owner, { contractId, milestones: [row('100')] }),
      ]);
      expect(results).toEqual([
        { ok: true, data: undefined },
        { ok: true, data: undefined },
      ]);
      expect([1, 3]).toContain((await storedRows(contractId)).length);
    }
  });

  it('a save racing an issue: the issue sees the schedule it freezes, or the save is refused', async () => {
    const orders = { saveFirst: 0, issueFirst: 0 };
    for (let run = 0; run < 8; run += 1) {
      const contractId = await draftContract();
      await saveContractScheduleCore(owner, { contractId, milestones: SPLIT_50_30_20 });
      const [saved, issued] = await Promise.all([
        saveContractScheduleCore(owner, { contractId, milestones: [row('100')] }),
        issueContractCore(owner, { id: contractId }),
      ]);
      expect(issued).toMatchObject({ ok: true });
      if (saved.ok) expect(await storedRows(contractId)).toHaveLength(1);
      else expect(saved).toEqual({ ok: false, error: 'contract_not_draft' });
      orders[saved.ok ? 'saveFirst' : 'issueFirst'] += 1;
    }
    console.info('save racing issue, orders seen:', orders);
  });
});
