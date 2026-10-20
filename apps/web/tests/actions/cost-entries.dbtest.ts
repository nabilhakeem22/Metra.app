import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createCostEntryCore, updateCostEntryCore, voidCostEntryCore } from '@/lib/execution/costs/core';
import { searchCostEntryLinesCore } from '@/lib/execution/costs/reads';
import { closeExecutionFixture, ownerQuery, seedClientProject, seedExecutionContract, type ExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Stage 2 PR B3.1: recording, editing and voiding a cost entry (المصروفات) on
// an execution contract (plan A15, AC20 to AC22). The database half (CHECKs,
// the 3-column FKs, no DELETE grant) is execution-schema.dbtest.ts.

const orgIds: string[] = [];
let owner: OrgContext;
let engineer: OrgContext;
let viewer: OrgContext;
let stranger: OrgContext;
let signed: ExecutionContract;
let sibling: ExecutionContract;

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1, members: [{ role: 'site_engineer' }, { role: 'viewer' }] });
  const other = await seedOrg({ owners: 1 });
  orgIds.push(studio.orgId, other.orgId);
  owner = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
  engineer = ctxFor(studio.orgId, studio.memberIds[0], 'site_engineer');
  viewer = ctxFor(studio.orgId, studio.memberIds[1], 'viewer');
  stranger = ctxFor(other.orgId, other.ownerIds[0], 'owner');
  signed = await seedExecutionContract(studio.orgId, { state: 'signed', linesPerSection: [2, 2] });
  sibling = await seedExecutionContract(studio.orgId, { state: 'issued', linesPerSection: [1] });
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const BASE = { category: 'materials', description: 'Cement, 20 bags', amount: '1,500', incurredOn: '2026-10-01' };

const create = (fields: Record<string, unknown> = {}, ctx: OrgContext = owner) =>
  createCostEntryCore(ctx, { contractId: signed.contractId, idempotencyKey: randomUUID(), ...BASE, ...fields });

const stored = async (id: string) =>
  (await ownerQuery<Record<string, unknown>>(
    `select category::text, description, amount::text, incurred_on::text, contract_section_id, contract_line_id,
            qty::text, unit::text, unit_cost::text, supplier, reference, recorded_by, voided_at, voided_by
       from public.contract_cost_entries where id = $1`,
    [id],
  ))[0];

describe('createCostEntryCore', () => {
  it('books to the whole contract, a section, or a line of that section, audited', async () => {
    const audits = await raw.count('audit_log', owner.orgId);
    const whole = await create({ supplier: ' El Sewedy ', reference: 'INV-7' });
    expect(whole).toMatchObject({ ok: true, already: false });
    expect(await stored(whole.data as string)).toMatchObject({
      category: 'materials', description: 'Cement, 20 bags', amount: '1500.0000', incurred_on: '2026-10-01',
      contract_section_id: null, contract_line_id: null, supplier: 'El Sewedy', reference: 'INV-7', recorded_by: owner.userId,
    });
    const section = await create({ contractSectionId: signed.sectionIds[1] });
    const line = await create({ contractSectionId: signed.sectionIds[0], contractLineId: signed.lineIds[0][1], qty: '2', unit: 'sqm', unitCost: '750' });
    expect(await stored(section.data as string)).toMatchObject({ contract_section_id: signed.sectionIds[1], contract_line_id: null });
    expect(await stored(line.data as string)).toMatchObject({ contract_line_id: signed.lineIds[0][1], qty: '2.0000', unit: 'sqm', unit_cost: '750.0000' });
    expect(await raw.count('audit_log', owner.orgId)).toBe(audits + 3);
  });

  it('says each typed fault under its box (AC20)', async () => {
    expect(await create({ qty: '2', unit: 'sqm' })).toEqual({ ok: false, error: 'check_fields', fields: { unitCost: { code: 'required' } } });
    expect(await create({ amount: '0' })).toMatchObject({ ok: false, error: 'check_fields', fields: { amount: { code: 'out_of_range' } } });
    expect(await create({ description: '  ', amount: 'abc', incurredOn: '2999-01-01', supplier: 's'.repeat(121) })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: {
        description: { code: 'required' },
        amount: { code: 'not_a_number' },
        incurredOn: { code: 'date_in_future' },
        supplier: { code: 'too_long', params: { max: 120 } },
      },
    });
    expect(await create({ contractLineId: signed.lineIds[0][0] })).toEqual({ ok: false, error: 'check_fields', fields: { contractSectionId: { code: 'required' } } });
    expect(await create({ description: '​' })).toEqual({ ok: false, error: 'check_fields', fields: { description: { code: 'required' } } });
  });

  it('refuses a line of another contract, or of another section of this one (AC21)', async () => {
    expect(await create({ contractSectionId: signed.sectionIds[0], contractLineId: sibling.lineIds[0][0] })).toEqual({ ok: false, error: 'line_not_in_contract' });
    expect(await create({ contractSectionId: signed.sectionIds[1], contractLineId: signed.lineIds[0][0] })).toEqual({ ok: false, error: 'line_not_in_contract' });
    expect(await create({ contractSectionId: sibling.sectionIds[0] })).toEqual({
      ok: false, error: 'check_fields', fields: { contractSectionId: { code: 'no_longer_exists' } },
    });
  });

  it('records once per key: a replay answers already with the first id (AC22 idempotency)', async () => {
    const key = randomUUID();
    const first = await create({ idempotencyKey: key });
    const before = await raw.count('contract_cost_entries', owner.orgId);
    expect(await create({ idempotencyKey: key, amount: '9' })).toEqual({ ok: true, data: first.data, already: true });
    expect(await raw.count('contract_cost_entries', owner.orgId)).toBe(before);
  });

  it('refuses a draft contract, a proposal contract, an unknown one and a forged input', async () => {
    const draft = await seedExecutionContract(owner.orgId, { state: 'draft' });
    expect(await create({ contractId: draft.contractId })).toEqual({ ok: false, error: 'contract_not_issued' });
    const { clientId, projectId } = await seedClientProject(owner.orgId);
    const [proposal] = await ownerQuery<{ id: string }>(
      `insert into public.proposals (org_id, number, title_en, client_id, project_id, status)
       values ($1, 800000 + floor(random() * 99999)::int, 'Quote', $2, $3, 'accepted') returning id`,
      [owner.orgId, clientId, projectId],
    );
    const [quoted] = await ownerQuery<{ id: string }>(
      `insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id)
       values ($1, 800000 + floor(random() * 99999)::int, 'Quoted', $2, $3, $4) returning id`,
      [owner.orgId, proposal.id, clientId, projectId],
    );
    expect(await create({ contractId: quoted.id })).toEqual({ ok: false, error: 'contract_not_execution' });
    expect(await create({ contractId: randomUUID() })).toEqual({ ok: false, error: 'record_not_found' });
    expect(await create({ category: 'bribes' })).toEqual({ ok: false, error: 'malformed' });
    expect(await create({ idempotencyKey: undefined })).toEqual({ ok: false, error: 'malformed' });
    expect(await createCostEntryCore(owner, null as never)).toEqual({ ok: false, error: 'malformed' });
  });

  it('lets a site engineer record, and refuses a viewer and another studio', async () => {
    expect(await create({}, engineer)).toMatchObject({ ok: true });
    expect(await create({}, viewer)).toEqual({ ok: false, error: 'forbidden' });
    expect(await create({}, stranger)).toEqual({ ok: false, error: 'record_not_found' });
  });
});

describe('updateCostEntryCore and voidCostEntryCore (AC22)', () => {
  it('edits a live entry and audits what it was', async () => {
    const { data: id } = await create();
    expect(await updateCostEntryCore(owner, { id, ...BASE, amount: '1750.5', contractSectionId: signed.sectionIds[1] })).toEqual({ ok: true });
    expect(await stored(id as string)).toMatchObject({ amount: '1750.5000', contract_section_id: signed.sectionIds[1] });
    const [audit] = await ownerQuery<{ before: { amount: string } }>(
      `select before from public.audit_log where entity = 'contract_cost_entry' and entity_id = $1 and action = 'update'`,
      [id],
    );
    expect(audit.before.amount).toBe('1500.0000');
  });

  it('keeps the line-in-section check on an edit', async () => {
    const { data: id } = await create();
    expect(await updateCostEntryCore(owner, { id, ...BASE, contractSectionId: signed.sectionIds[1], contractLineId: signed.lineIds[0][0] })).toEqual({
      ok: false, error: 'line_not_in_contract',
    });
  });

  it('voids once, keeps the row, and refuses editing or voiding it again', async () => {
    const { data: id } = await create();
    expect(await voidCostEntryCore(owner, { id })).toEqual({ ok: true });
    expect(await stored(id as string)).toMatchObject({ voided_by: owner.userId, amount: '1500.0000' });
    expect(await voidCostEntryCore(owner, { id })).toEqual({ ok: false, error: 'cost_entry_voided' });
    expect(await updateCostEntryCore(owner, { id, ...BASE })).toEqual({ ok: false, error: 'cost_entry_voided' });
  });

  it('answers not found for an unknown entry or another studio, forbidden for a viewer', async () => {
    const { data: id } = await create();
    expect(await voidCostEntryCore(owner, { id: randomUUID() })).toEqual({ ok: false, error: 'cost_entry_not_found' });
    expect(await voidCostEntryCore(stranger, { id })).toEqual({ ok: false, error: 'cost_entry_not_found' });
    expect(await updateCostEntryCore(stranger, { id, ...BASE })).toEqual({ ok: false, error: 'cost_entry_not_found' });
    expect(await voidCostEntryCore(viewer, { id })).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('searchCostEntryLinesCore', () => {
  it("answers each line with its section, for a role that may record costs only", async () => {
    const found = await searchCostEntryLinesCore(owner, { contractId: signed.contractId, query: '', afterLineId: null });
    expect(found.data?.lines.map((line) => [line.id, line.sectionId])).toEqual(
      signed.lineIds.flatMap((lines, section) => lines.map((lineId) => [lineId, signed.sectionIds[section]])),
    );
    expect(await searchCostEntryLinesCore(viewer, { contractId: signed.contractId, query: '', afterLineId: null })).toEqual({ ok: false, error: 'forbidden' });
    expect(await searchCostEntryLinesCore(stranger, { contractId: signed.contractId, query: '', afterLineId: null })).toEqual({
      ok: false, error: 'record_not_found',
    });
  });
});
