import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateExecutionContractCore, setContractChargesCore } from '@/lib/contracts/core';
import type { OrgContext } from '@/lib/db/context';
import { seedBoq, seedProposalContract } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A3.1: an execution contract generated from an issued BOQ (AC1 to AC4), and
// its charges re-priced while it is a draft.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let pm: OrgContext;
let viewer: OrgContext;
let otherOwner: OrgContext;

const CHARGES = { taxRate: '14', supervisionPct: '10' };

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }, { role: 'viewer' }] });
  const other = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId, other.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  pm = ctxFor(orgId, seeded.memberIds[0], 'project_manager');
  viewer = ctxFor(orgId, seeded.memberIds[1], 'viewer');
  otherOwner = ctxFor(other.orgId, other.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

async function contractRow(contractId: string) {
  const [row] = await ownerQuery<Record<string, string | null>>(
    `select status, source_boq_id, source_proposal_id, taxable_base::text, tax_rate::text, tax_amount::text,
            supervision_pct::text, supervision_amount::text, original_value::text, subtotal::text,
            total_cost::text, total_margin::text, retention_pct::text, advance_pct::text
       from public.contracts where id = $1`,
    [contractId],
  );
  return row;
}

describe('AC1: the 2,000-line BOQ becomes one draft contract, line for line', () => {
  it('copies every section and line exactly, item codes and provisional flags included', async () => {
    const boq = await seedBoq(orgId, { linesPerSection: Array.from({ length: 20 }, () => 100) });
    const started = performance.now();
    const res = await generateExecutionContractCore(owner, { boqId: boq.boqId, ...CHARGES });
    const elapsed = performance.now() - started;
    expect(res).toMatchObject({ ok: true });
    const contractId = res.data!;
    console.info(`generate from a 2,000-line BOQ: ${elapsed.toFixed(0)} ms`);

    const contract = await contractRow(contractId);
    const [boqRow] = await ownerQuery<{ total: string }>(`select total::text from public.boqs where id = $1`, [boq.boqId]);
    expect(contract).toMatchObject({ status: 'draft', source_boq_id: boq.boqId, source_proposal_id: null });
    expect(contract.taxable_base).toBe(boqRow.total);

    const [counts] = await ownerQuery<{ lines: number; sections: number }>(
      `select (select count(*) from public.contract_lines where contract_id = $1)::int as lines,
              (select count(*) from public.contract_sections where contract_id = $1)::int as sections`,
      [contractId],
    );
    expect(counts).toEqual({ lines: 2000, sections: 20 });

    // Every BOQ line has its twin: same section (by sort order and title) and same values.
    const [diff] = await ownerQuery<{ unmatched: number }>(
      `select count(*)::int as unmatched
         from public.boq_lines bl
         join public.boq_sections bs on bs.id = bl.section_id
        where bl.boq_id = $1
          and not exists (
            select 1 from public.contract_lines cl
              join public.contract_sections cs on cs.id = cl.section_id
             where cl.contract_id = $2 and cs.sort_order = bs.sort_order and cs.title_en = bs.title_en
               and cs.section_subtotal = bs.section_subtotal
               and cl.sort_order = bl.sort_order and cl.qty = bl.qty and cl.unit = bl.unit
               and cl.unit_price = bl.unit_price and cl.unit_cost = bl.unit_cost
               and cl.discount_pct = bl.discount_pct and cl.line_total = bl.line_total
               and cl.line_cost = bl.line_cost and cl.line_margin = bl.line_margin
               and cl.item_code is not distinct from bl.item_code and cl.provisional = bl.provisional
               and cl.description_en is not distinct from bl.description_en)`,
      [boq.boqId, contractId],
    );
    expect(diff.unmatched).toBe(0);
  });
});

describe('AC2: one contract per BOQ', () => {
  it('two concurrent generates make exactly one contract; the loser is contract_exists', async () => {
    const boq = await seedBoq(orgId);
    const results = await Promise.all([
      generateExecutionContractCore(owner, { boqId: boq.boqId, ...CHARGES }),
      generateExecutionContractCore(owner, { boqId: boq.boqId, ...CHARGES }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, error: 'contract_exists' });
    const [row] = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from public.contracts where source_boq_id = $1`,
      [boq.boqId],
    );
    expect(row.n).toBe(1);
  });
});

describe('AC3: which BOQ may be contracted', () => {
  it('refuses a draft and a superseded BOQ (boq_not_issued)', async () => {
    for (const state of ['draft', 'superseded'] as const) {
      const boq = await seedBoq(orgId, { state });
      expect(await generateExecutionContractCore(owner, { boqId: boq.boqId, ...CHARGES })).toEqual({
        ok: false,
        error: 'boq_not_issued',
      });
    }
  });

  it('refuses a BOQ whose delivery has not chosen execution, and allows one with no delivery', async () => {
    const early = await seedBoq(orgId, { deliveryState: 'boq' });
    expect(await generateExecutionContractCore(owner, { boqId: early.boqId, ...CHARGES })).toEqual({
      ok: false,
      error: 'delivery_not_in_execution',
    });
    const standalone = await seedBoq(orgId, { deliveryState: null });
    expect(await generateExecutionContractCore(owner, { boqId: standalone.boqId, ...CHARGES })).toMatchObject({ ok: true });
  });

  it("answers boq_not_found for another studio's BOQ, and malformed for a non-id", async () => {
    const boq = await seedBoq(orgId);
    expect(await generateExecutionContractCore(otherOwner, { boqId: boq.boqId, ...CHARGES })).toEqual({
      ok: false,
      error: 'boq_not_found',
    });
    expect(await generateExecutionContractCore(owner, { boqId: 'not-an-id', ...CHARGES })).toEqual({
      ok: false,
      error: 'malformed',
    });
  });

  it('is owner and admin work: a project manager and a viewer are forbidden', async () => {
    const boq = await seedBoq(orgId);
    for (const ctx of [pm, viewer]) {
      expect(await generateExecutionContractCore(ctx, { boqId: boq.boqId, ...CHARGES })).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
  });
});

describe('AC4: the charges', () => {
  it('says not_a_number and out_of_range under the rate, and writes nothing', async () => {
    const boq = await seedBoq(orgId);
    const typo = await generateExecutionContractCore(owner, { boqId: boq.boqId, taxRate: 'abc', supervisionPct: '0' });
    expect(typo).toMatchObject({ ok: false, error: 'check_fields', fields: { taxRate: { code: 'not_a_number' } } });
    const over = await generateExecutionContractCore(owner, { boqId: boq.boqId, taxRate: '101', supervisionPct: '' });
    expect(over).toMatchObject({
      error: 'check_fields',
      fields: { taxRate: { code: 'out_of_range', params: { min: 0, max: 100 } }, supervisionPct: { code: 'required' } },
    });
    const [row] = await ownerQuery<{ n: number }>(`select count(*)::int as n from public.contracts where source_boq_id = $1`, [boq.boqId]);
    expect(row.n).toBe(0);
  });

  it('VAT 14 and supervision 10 on 100,000.0000 make 124,000.0000; retention and advance stay 0', async () => {
    const boq = await seedBoq(orgId, { total: '100000' });
    const res = await generateExecutionContractCore(owner, { boqId: boq.boqId, ...CHARGES });
    expect(await contractRow(res.data!)).toMatchObject({
      taxable_base: '100000.0000',
      tax_rate: '14.0000',
      tax_amount: '14000.0000',
      supervision_pct: '10.0000',
      supervision_amount: '10000.0000',
      original_value: '124000.0000',
      retention_pct: '0.0000',
      advance_pct: '0.0000',
    });
  });

  it('re-prices a draft execution contract; refuses an issued one and a proposal contract', async () => {
    const boq = await seedBoq(orgId, { total: '100000' });
    const contractId = (await generateExecutionContractCore(owner, { boqId: boq.boqId, ...CHARGES })).data!;
    expect(await setContractChargesCore(owner, { contractId, taxRate: '0', supervisionPct: '5' })).toEqual({ ok: true, data: undefined });
    expect(await contractRow(contractId)).toMatchObject({ tax_amount: '0.0000', supervision_amount: '5000.0000', original_value: '105000.0000' });
    expect(await setContractChargesCore(owner, { contractId, taxRate: '14', supervisionPct: '200' })).toMatchObject({
      error: 'check_fields',
      fields: { supervisionPct: { code: 'out_of_range' } },
    });
    expect(await setContractChargesCore(pm, { contractId, ...CHARGES })).toEqual({ ok: false, error: 'forbidden' });

    const issued = await seedExecutionContract(orgId, { state: 'issued' });
    expect(await setContractChargesCore(owner, { contractId: issued.contractId, ...CHARGES })).toEqual({
      ok: false,
      error: 'contract_not_draft',
    });
    const proposalContractId = await seedProposalContract(orgId);
    expect(await setContractChargesCore(owner, { contractId: proposalContractId, ...CHARGES })).toEqual({
      ok: false,
      error: 'contract_not_execution',
    });
  });
});
