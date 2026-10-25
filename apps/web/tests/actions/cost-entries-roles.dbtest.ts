import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { getCostContractHeader } from '@/lib/execution/costs/contract-view';
import { createCostEntryCore, updateCostEntryCore, voidCostEntryCore } from '@/lib/execution/costs/core';
import { loadCostEntriesCore, loadCostSectionsCore, searchCostEntryLinesCore } from '@/lib/execution/costs/reads';
import { NO_COST_FILTER } from '@/lib/execution/costs/types';
import { canSeeMargin } from '@/lib/permissions/can';
import type { MemberRole } from '@/lib/permissions/roles';
import { closeExecutionFixture, ownerQuery, seedClientProject, seedExecutionContract, type ExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Stage 2 PR B3 fix round (lead ruling F1 + S1): who reads, records, edits and
// voids a contract's costs. Reading and recording are the `cost_entries` row
// alone, so a project manager, a site engineer and an accountant (CRUA in the
// matrix) record costs without the contract page; owner and admin change any
// entry, every other writer only the ones it recorded. A role that fails the
// read (viewer, client) gets no entry id and no amount from any surface. Plus
// F3 (totals past numeric(18,4)), F6 (year 0000) and the upper-case key.

const ROLES: readonly MemberRole[] = ['owner', 'admin', 'project_manager', 'site_engineer', 'accountant', 'viewer', 'client'];
const WRITERS: readonly MemberRole[] = ['owner', 'admin', 'project_manager', 'site_engineer', 'accountant'];
const KEEPERS: readonly MemberRole[] = ['owner', 'admin'];
const OUTSIDERS: readonly MemberRole[] = ['viewer', 'client'];

const orgIds: string[] = [];
const ctx = {} as Record<MemberRole, OrgContext>;
let signed: ExecutionContract;
let capped: ExecutionContract;

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1, members: ROLES.filter((role) => role !== 'owner').map((role) => ({ role })) });
  orgIds.push(studio.orgId);
  ctx.owner = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
  ROLES.filter((role) => role !== 'owner').forEach((role, n) => {
    ctx[role] = ctxFor(studio.orgId, studio.memberIds[n], role);
  });
  signed = await seedExecutionContract(studio.orgId, { state: 'signed', linesPerSection: [2, 2] });
  capped = await seedExecutionContract(studio.orgId, { state: 'signed' });
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const BASE = { category: 'materials', description: 'Cement, 20 bags', amount: '1,500', incurredOn: '2026-10-01' };

const record = (as: OrgContext, fields: Record<string, unknown> = {}) =>
  createCostEntryCore(as, { contractId: signed.contractId, idempotencyKey: randomUUID(), ...BASE, ...fields });

async function recordAs(as: OrgContext): Promise<string> {
  const written = await record(as);
  expect(written).toMatchObject({ ok: true, already: false });
  return written.data as string;
}

const list = (as: OrgContext, contractId = signed.contractId) => loadCostEntriesCore(as, { contractId, filter: NO_COST_FILTER, cursor: null });

describe('who may do what with costs (F1, S1)', () => {
  it.each(ROLES)('%s', async (role) => {
    const as = ctx[role];
    const writer = WRITERS.includes(role);
    const keeper = KEEPERS.includes(role);
    const ownersEntry = await recordAs(ctx.owner);

    // Read: the list, the sections and the line search answer the cost roles, and no one else.
    const listed = await list(as);
    const sections = await loadCostSectionsCore(as, { contractId: signed.contractId, afterSectionId: null });
    const lines = await searchCostEntryLinesCore(as, { contractId: signed.contractId, query: '', afterLineId: null });
    if (!writer) {
      for (const refused of [listed, sections, lines]) expect(refused).toEqual({ ok: false, error: 'forbidden' });
      expect(await record(as)).toEqual({ ok: false, error: 'forbidden' });
      expect(await updateCostEntryCore(as, { id: ownersEntry, ...BASE, amount: '1' })).toEqual({ ok: false, error: 'forbidden' });
      expect(await voidCostEntryCore(as, { id: ownersEntry })).toEqual({ ok: false, error: 'forbidden' });
      return;
    }
    expect(listed.ok).toBe(true);
    expect(sections.data?.sections.map((section) => Object.keys(section).sort())).toEqual([
      ['id', 'titleAr', 'titleEn'],
      ['id', 'titleAr', 'titleEn'],
    ]);
    // Descriptions and sections only: nothing priced reaches a role that may not open the contract page.
    for (const line of lines.data?.lines ?? []) {
      expect(Object.keys(line).sort()).toEqual(['descriptionAr', 'descriptionEn', 'id', 'sectionId', 'sectionTitleAr', 'sectionTitleEn']);
    }
    expect(lines.data?.lines).toHaveLength(4);

    // Create, then edit and void its own.
    const own = await recordAs(as);
    expect(await updateCostEntryCore(as, { id: own, ...BASE, amount: '1,600' })).toEqual({ ok: true });
    expect(await voidCostEntryCore(as, { id: own })).toEqual({ ok: true });

    // Another member's entry: a keeper changes it; anyone else is refused and the row is untouched.
    const other = await recordAs(role === 'owner' ? ctx.admin : ctx.owner);
    const edit = await updateCostEntryCore(as, { id: other, ...BASE, amount: '99' });
    const voided = await voidCostEntryCore(as, { id: other });
    if (keeper) {
      expect(edit).toEqual({ ok: true });
      expect(voided).toEqual({ ok: true });
    } else {
      expect(edit).toEqual({ ok: false, error: 'forbidden' });
      expect(voided).toEqual({ ok: false, error: 'forbidden' });
      const [row] = await ownerQuery<{ amount: string; voided_at: unknown }>(`select amount::text, voided_at from public.contract_cost_entries where id = $1`, [other]);
      expect(row).toEqual({ amount: '1500.0000', voided_at: null });
    }

    // Each listed row says whether THIS member may change it, and never who recorded it.
    const rows = (await list(as)).data?.entries ?? [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(own)?.editable).toBe(true);
    // A member who may not see margin (here the site engineer; this studio shows
    // margin to PMs) lists only what it recorded (owner ruling, Oct 21).
    if (canSeeMargin(role, false)) expect(byId.get(ownersEntry)?.editable).toBe(keeper);
    else expect(byId.has(ownersEntry)).toBe(false);
    for (const row of rows) expect(Object.keys(row)).not.toContain('recordedBy');
  });

  it('a writer who is not a keeper is refused on another member\'s voided entry before it is told it is voided', async () => {
    const entry = await recordAs(ctx.owner);
    expect(await voidCostEntryCore(ctx.owner, { id: entry })).toEqual({ ok: true });
    expect(await voidCostEntryCore(ctx.site_engineer, { id: entry })).toEqual({ ok: false, error: 'forbidden' });
    expect(await updateCostEntryCore(ctx.project_manager, { id: entry, ...BASE })).toEqual({ ok: false, error: 'forbidden' });
    expect(await voidCostEntryCore(ctx.admin, { id: entry })).toEqual({ ok: false, error: 'cost_entry_voided' });
  });

  it.each(OUTSIDERS)('no surface hands %s an entry id or an amount', async (role) => {
    const entry = await recordAs(ctx.owner);
    const answers = [
      await list(ctx[role]),
      await loadCostEntriesCore(ctx[role], { contractId: signed.contractId, filter: NO_COST_FILTER, cursor: { incurredOn: '2026-10-01', id: entry } }),
      await loadCostSectionsCore(ctx[role], { contractId: signed.contractId, afterSectionId: null }),
      await searchCostEntryLinesCore(ctx[role], { contractId: signed.contractId, query: '', afterLineId: null }),
      await record(ctx[role]),
      await updateCostEntryCore(ctx[role], { id: entry, ...BASE }),
      await voidCostEntryCore(ctx[role], { id: entry }),
    ];
    for (const answer of answers) expect(answer).toEqual({ ok: false, error: 'forbidden' });
    const said = JSON.stringify(answers);
    expect(said).not.toContain(entry);
    expect(said).not.toContain('1500');
  });

  it('the costs page header names the contract and carries no money; a proposal contract has none', async () => {
    const header = await getCostContractHeader(ctx.site_engineer, signed.contractId);
    expect(Object.keys(header ?? {}).sort()).toEqual(['clientNameAr', 'clientNameEn', 'createdAt', 'id', 'number', 'status', 'titleAr', 'titleEn']);
    expect(header).toMatchObject({ id: signed.contractId, status: 'signed' });
    expect(await getCostContractHeader(ctx.site_engineer, randomUUID())).toBeNull();
    const { clientId, projectId } = await seedClientProject(ctx.owner.orgId);
    const [proposal] = await ownerQuery<{ id: string }>(
      `insert into public.proposals (org_id, number, title_en, client_id, project_id, status)
       values ($1, 800000 + floor(random() * 99999)::int, 'Quote', $2, $3, 'accepted') returning id`,
      [ctx.owner.orgId, clientId, projectId],
    );
    const [quoted] = await ownerQuery<{ id: string }>(
      `insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id)
       values ($1, 800000 + floor(random() * 99999)::int, 'Quoted', $2, $3, $4) returning id`,
      [ctx.owner.orgId, proposal.id, clientId, projectId],
    );
    expect(await getCostContractHeader(ctx.owner, quoted.id)).toBeNull();
  });
});

describe('totals, dates and keys (F3, F6, idempotency)', () => {
  it('loads a contract whose live costs pass what one entry holds: 101 entries at the cap (F3)', async () => {
    const CAP = '1,000,000,000,000';
    for (let n = 0; n < 101; n += 1) {
      expect(await createCostEntryCore(ctx.owner, { contractId: capped.contractId, idempotencyKey: randomUUID(), ...BASE, amount: CAP })).toMatchObject({ ok: true });
    }
    const page = await list(ctx.owner, capped.contractId);
    expect(page.ok).toBe(true);
    expect(page.data?.totals).toEqual({ count: 101, amount: '101000000000000.0000' });
    expect(page.data?.entries).toHaveLength(50);
  });

  it('says a year-0000 or pre-2000 day under its box, and a cursor naming one as a date refusal, never generic (F6)', async () => {
    for (const incurredOn of ['0000-01-01', '1999-12-31']) {
      expect(await record(ctx.owner, { incurredOn })).toEqual({ ok: false, error: 'check_fields', fields: { incurredOn: { code: 'invalid_date' } } });
    }
    expect(await record(ctx.owner, { incurredOn: '2000-01-01' })).toMatchObject({ ok: true });
    for (const incurredOn of ['0000-01-01', '1999-12-31']) {
      expect(await loadCostEntriesCore(ctx.owner, { contractId: signed.contractId, filter: NO_COST_FILTER, cursor: { incurredOn, id: randomUUID() } })).toEqual({
        ok: false, error: 'check_fields', fields: { cursor: { code: 'invalid_date' } },
      });
    }
  });

  it('a key in capitals is the same key: the replay records nothing', async () => {
    const key = randomUUID();
    const first = await record(ctx.owner, { idempotencyKey: key });
    const before = await raw.count('contract_cost_entries', ctx.owner.orgId);
    expect(await record(ctx.owner, { idempotencyKey: key.toUpperCase() })).toEqual({ ok: true, data: first.data, already: true });
    expect(await raw.count('contract_cost_entries', ctx.owner.orgId)).toBe(before);
  });
});
