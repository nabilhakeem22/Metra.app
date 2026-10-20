import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getContractPage } from '@/lib/contracts/queries';
import type { OrgContext } from '@/lib/db/context';
import { revisedFinishDate } from '@/lib/execution/finish-date';
import {
  createVariationDraftCore,
  internalApproveVariationCore,
  issueVariationCore,
  saveVariationDraftCore,
} from '@/lib/variations/core';
import { getVariationByToken, respondToVariationByToken } from '@/lib/variations/public';
import { seedProposalContract } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedVariation, type ExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR B5 (A24, the time part of AC19): a change order of an execution contract
// may add whole days (0 to 3650, set while draft) to the finish date; the
// revised finish is the end date plus the APPROVED orders' days. A proposal
// contract's order carries none.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let contract: ExecutionContract;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  contract = await seedExecutionContract(orgId, { linesPerSection: [1], state: 'signed' });
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const LINE = { descriptionEn: 'Extra door', qty: '1', unit: 'pcs' as const, unitCost: '0', unitPrice: '1000', discountPct: '0' };

async function storedDays(variationOrderId: string): Promise<number | null> {
  const [row] = await ownerQuery<{ days: number | null }>(
    `select time_extension_days as days from public.variation_orders where id = $1`,
    [variationOrderId],
  );
  return row.days;
}

async function draftWithDays(days: unknown): Promise<string> {
  const created = await createVariationDraftCore(owner, { contractId: contract.contractId, titleEn: 'Delay', timeExtensionDays: days });
  expect(created).toMatchObject({ ok: true });
  return (created as { data?: string }).data!;
}

/** Internal approval, issue and the client's approval on /v: the real path. */
async function approve(variationOrderId: string): Promise<void> {
  const approved = await internalApproveVariationCore(owner, { id: variationOrderId });
  expect(approved.ok).toBe(true);
  expect((await issueVariationCore(owner, { id: variationOrderId })).ok).toBe(true);
  expect((await respondToVariationByToken(approved.data as string, { decision: 'approve' })).ok).toBe(true);
}

describe('the days a change order adds (A24)', () => {
  it('AC19 time part: two approved orders of 15 days each move the revised finish by 30 days', async () => {
    const before = await getContractPage(owner, contract.contractId, true);
    expect(before!.approvedExtensionDays).toBe(0);
    for (const _order of [1, 2]) {
      const id = await draftWithDays('15');
      expect((await saveVariationDraftCore(owner, { id, header: { titleEn: 'Delay' }, lines: [LINE] })).ok).toBe(true);
      await approve(id);
    }
    // An order still open adds nothing until the client approves it.
    await draftWithDays('40');
    const after = await getContractPage(owner, contract.contractId, true);
    expect(after!.approvedExtensionDays).toBe(30);
    expect(after!.endDate).toBe('2026-12-31');
    expect(revisedFinishDate(after!.endDate, after!.approvedExtensionDays)).toBe('2027-01-30');
    // Two approved orders of 1,000 each: the revised value still adds up (one SQL sum).
    expect(after!.revisedValue).toBe('126000.0000');
  });

  it('a blank box stores no extension; whole days from 0 to 3650 are stored as typed', async () => {
    expect(await storedDays(await draftWithDays(''))).toBeNull();
    expect(await storedDays(await draftWithDays(undefined))).toBeNull();
    expect(await storedDays(await draftWithDays('0'))).toBe(0);
    expect(await storedDays(await draftWithDays('3650'))).toBe(3650);
  });

  it('days outside 0 to 3650, a fraction or not a number are refused under the box, and nothing is written', async () => {
    const [{ count: before }] = await ownerQuery<{ count: number }>(
      `select count(*)::int as count from public.variation_orders where org_id = $1`,
      [orgId],
    );
    for (const [days, code] of [['3651', 'out_of_range'], ['-1', 'out_of_range'], ['1.5', 'out_of_range'], ['abc', 'not_a_number'], [{}, 'not_a_number']] as const) {
      const res = await createVariationDraftCore(owner, { contractId: contract.contractId, titleEn: 'Delay', timeExtensionDays: days });
      expect(res).toMatchObject({ ok: false, error: 'check_fields', fields: { timeExtensionDays: { code } } });
    }
    const both = await createVariationDraftCore(owner, { contractId: contract.contractId, timeExtensionDays: '9999' });
    expect(Object.keys(both.fields ?? {}).sort()).toEqual(['timeExtensionDays', 'title']);
    const [{ count: after }] = await ownerQuery<{ count: number }>(
      `select count(*)::int as count from public.variation_orders where org_id = $1`,
      [orgId],
    );
    expect(after).toBe(before);
  });

  it('the save edits the days while draft: absent keeps them, blank clears them, and a bad value is said with the line refusals', async () => {
    const id = await draftWithDays('10');
    expect((await saveVariationDraftCore(owner, { id, header: { titleEn: 'Delay' }, lines: [] })).ok).toBe(true);
    expect(await storedDays(id)).toBe(10);
    expect((await saveVariationDraftCore(owner, { id, header: { timeExtensionDays: '20' }, lines: [] })).ok).toBe(true);
    expect(await storedDays(id)).toBe(20);
    const refused = await saveVariationDraftCore(owner, {
      id,
      header: { timeExtensionDays: '4000' },
      lines: [{ ...LINE, qty: 'abc' }],
    });
    expect(refused).toMatchObject({ error: 'check_fields', fields: { timeExtensionDays: { code: 'out_of_range' } } });
    expect(Object.keys(refused.fields ?? {}).some((path) => path.startsWith('lines.'))).toBe(true);
    expect(await storedDays(id)).toBe(20);
    expect((await saveVariationDraftCore(owner, { id, header: { timeExtensionDays: '' }, lines: [] })).ok).toBe(true);
    expect(await storedDays(id)).toBeNull();
  });

  it('once the order leaves draft its days are frozen: the save answers variation_not_draft', async () => {
    const id = await draftWithDays('5');
    expect((await internalApproveVariationCore(owner, { id })).ok).toBe(true);
    const res = await saveVariationDraftCore(owner, { id, header: { timeExtensionDays: '50' }, lines: [] });
    expect(res).toMatchObject({ ok: false, error: 'variation_not_draft' });
    expect(await storedDays(id)).toBe(5);
  });

  it('a proposal contract\'s order carries no days: contract_not_execution, and nothing is written', async () => {
    const proposalContractId = await seedProposalContract(orgId);
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [proposalContractId]);
    const refused = await createVariationDraftCore(owner, { contractId: proposalContractId, titleEn: 'Delay', timeExtensionDays: '5' });
    expect(refused).toMatchObject({ ok: false, error: 'contract_not_execution' });
    const created = await createVariationDraftCore(owner, { contractId: proposalContractId, titleEn: 'No delay' });
    expect(created.ok).toBe(true);
    const id = (created as { data?: string }).data!;
    expect(await saveVariationDraftCore(owner, { id, header: { timeExtensionDays: '5' }, lines: [] })).toMatchObject({
      ok: false,
      error: 'contract_not_execution',
    });
    expect((await saveVariationDraftCore(owner, { id, header: { timeExtensionDays: null }, lines: [] })).ok).toBe(true);
    const [{ count }] = await ownerQuery<{ count: number }>(
      `select count(*)::int as count from public.variation_orders where contract_id = $1`,
      [proposalContractId],
    );
    expect(count).toBe(1);
    expect(await storedDays(id)).toBeNull();
    expect((await getContractPage(owner, proposalContractId, true))!.approvedExtensionDays).toBe(0);
  });
});

describe('/v reads the breakdown rates and the days (D4a)', () => {
  it('an execution contract\'s order carries its contract\'s rates and its days, mapped and typed', async () => {
    const { mintShareToken } = await import('@/lib/share/token');
    const token = mintShareToken();
    await seedVariation(orgId, contract, 'issued', { timeExtensionDays: 12, tokenHash: token.hash });
    const read = await getVariationByToken(token.raw);
    expect(read).toMatchObject({ charges: { taxRate: '14.0000', supervisionPct: '10.0000' }, timeExtensionDays: 12 });
    expect(Object.keys(read!)).not.toContain('tax_rate');
  });
});
