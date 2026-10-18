// The contract page is bounded whatever the contract's size (PR B1, A27): the
// page opens with sections counted in SQL and at most 50 lines, each section
// pages 50 at a time, the variation picker searches 50 at a time, and only the
// PDF still reads every line.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSectionLinesCore, searchBaselineLinesCore } from '@/lib/contracts/lines-core';
import { getContractForPdf, getContractPage, type ContractLinesPage } from '@/lib/contracts/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/**
 * A draft contract of `sections` x `perSection` lines, written over the
 * BYPASSRLS connection. The LAST section's lines all share sort_order 0, so
 * only their ids order them.
 */
async function seedContract(orgId: string, number: number, sections: number, perSection: number) {
  const [{ client, project }] = await raw.query<{ client: string; project: string }>(
    `with c as (insert into public.clients (org_id, name_en) values ('${orgId}', 'Client ${number}') returning id)
     insert into public.projects (org_id, code, name_en, client_id) select '${orgId}', 'P-${number}', 'Villa', id from c
     returning client_id as client, id as project`,
  );
  const [{ id: contractId }] = await raw.query<{ id: string }>(
    `with p as (insert into public.proposals (org_id, number, title_en, client_id, project_id)
                values ('${orgId}', ${number}, 'Quote', '${client}', '${project}') returning id)
     insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id)
     select '${orgId}', ${number}, 'Fit-out', id, '${client}', '${project}' from p returning id`,
  );
  await raw.query(
    `insert into public.contract_sections (org_id, contract_id, title_en, sort_order)
     select '${orgId}', '${contractId}', 'Section ' || s, s from generate_series(0, ${sections - 1}) s`,
  );
  await raw.query(
    `insert into public.contract_lines (org_id, contract_id, section_id, description_en, description_ar,
       qty, unit, unit_cost, unit_price, line_cost, line_total, line_margin, sort_order)
     select '${orgId}', '${contractId}', cs.id, 'Line ' || cs.sort_order || '.' || g, 'بند ' || cs.sort_order || '.' || g,
       1, 'sqm', 70, 100, 70, 100, 30, case when cs.sort_order = ${sections - 1} then 0 else g end
     from public.contract_sections cs cross join generate_series(0, ${perSection - 1}) g
     where cs.contract_id = '${contractId}'`,
  );
  await raw.query(
    `update public.contract_sections cs set section_subtotal = t.total
     from (select section_id, sum(line_total) total from public.contract_lines group by section_id) t
     where t.section_id = cs.id and cs.contract_id = '${contractId}'`,
  );
  const sectionIds = (
    await raw.query<{ id: string }>(
      `select id from public.contract_sections where contract_id = '${contractId}' order by sort_order`,
    )
  ).map((row) => row.id);
  return { contractId, sectionIds };
}

const COST_KEYS = /unitCost|lineCost|lineMargin|unit_cost|line_cost|line_margin/;
let owner: OrgContext;
let viewer: OrgContext;
let projectManager: OrgContext;
let stranger: OrgContext;
let big: { contractId: string; sectionIds: string[] };
let small: { contractId: string; sectionIds: string[] };

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1, members: [{ role: 'viewer' }, { role: 'project_manager' }] });
  const other = await seedOrg({ owners: 1 });
  orgIds.push(studio.orgId, other.orgId);
  owner = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
  viewer = ctxFor(studio.orgId, studio.memberIds[0], 'viewer');
  projectManager = ctxFor(studio.orgId, studio.memberIds[1], 'project_manager');
  stranger = ctxFor(other.orgId, other.ownerIds[0], 'owner');
  big = await seedContract(studio.orgId, 1, 20, 100);
  small = await seedContract(studio.orgId, 2, 2, 3);
});

const pageOf = (result: { ok: boolean; data?: ContractLinesPage }) => {
  expect(result.ok).toBe(true);
  return result.data!;
};

describe('the contract page opens bounded', () => {
  it('a 2,000-line contract: counts from SQL, the first 50 lines only, no cost', async () => {
    const page = (await getContractPage(owner, big.contractId, true))!;
    expect(page.sections).toHaveLength(20);
    expect(page.sections.reduce((sum, section) => sum + section.lineCount, 0)).toBe(2000);
    expect(page.sections.map((section) => section.openingLines.length)).toEqual([50, ...Array(19).fill(0)]);
    expect(page.sections[0].openingLines[0].descriptionEn).toBe('Line 0.0');
    expect(page.sections[0].sectionSubtotal).toBe('10000.0000');
    expect(JSON.stringify(page.sections)).not.toMatch(COST_KEYS);
  });

  it('a small contract opens whole', async () => {
    const page = (await getContractPage(owner, small.contractId, true))!;
    expect(page.sections.map((section) => [section.lineCount, section.openingLines.length])).toEqual([[3, 3], [3, 3]]);
  });

  it('the PDF still reads every line', async () => {
    const pdf = (await getContractForPdf(owner, big.contractId, true))!;
    expect(pdf.sections.reduce((sum, section) => sum + section.lines.length, 0)).toBe(2000);
  });
});

describe('one section, 50 lines a request', () => {
  it('walks a 100-line section of tied sort orders to its end: every line once, in id order', async () => {
    const sectionId = big.sectionIds[19];
    const seen: string[] = [];
    let afterLineId: string | null = null;
    for (let request = 0; request < 5; request += 1) {
      const page = pageOf(await loadSectionLinesCore(owner, { contractId: big.contractId, sectionId, afterLineId }));
      expect(page.lines.length).toBeLessThanOrEqual(50);
      seen.push(...page.lines.map((line) => line.id));
      if (!page.hasMore) break;
      afterLineId = seen[seen.length - 1];
    }
    const expected = await raw.query<{ id: string }>(
      `select id from public.contract_lines where section_id = '${sectionId}' order by sort_order, id`,
    );
    expect(seen).toEqual(expected.map((row) => row.id));
  });

  it('a section, a cursor or a contract from elsewhere answers an empty page', async () => {
    const empty = { lines: [], hasMore: false };
    const otherContractSection = { contractId: big.contractId, sectionId: small.sectionIds[0], afterLineId: null };
    expect(pageOf(await loadSectionLinesCore(owner, otherContractSection))).toEqual(empty);
    const [foreignLine] = await raw.query<{ id: string }>(
      `select id from public.contract_lines where section_id = '${big.sectionIds[1]}' limit 1`,
    );
    const foreignCursor = { contractId: big.contractId, sectionId: big.sectionIds[0], afterLineId: foreignLine.id };
    expect(pageOf(await loadSectionLinesCore(owner, foreignCursor))).toEqual(empty);
    const firstPage = { contractId: big.contractId, sectionId: big.sectionIds[0], afterLineId: null };
    expect(pageOf(await loadSectionLinesCore(stranger, firstPage))).toEqual(empty);
  });

  it('refuses malformed input and a role that cannot open the page', async () => {
    const valid = { contractId: big.contractId, sectionId: big.sectionIds[0], afterLineId: null };
    for (const input of [null, 'x', { ...valid, contractId: 'x' }, { ...valid, sectionId: 7 }, { ...valid, afterLineId: {} }]) {
      expect(await loadSectionLinesCore(owner, input)).toEqual({ ok: false, error: 'malformed' });
    }
    expect(await loadSectionLinesCore(projectManager, valid)).toEqual({ ok: false, error: 'forbidden' });
    expect(pageOf(await loadSectionLinesCore(viewer, valid)).lines).toHaveLength(50);
  });
});

describe('the variation picker searches, 50 at a time', () => {
  it('lists the first 50, finds by either language, and takes % and _ literally', async () => {
    const search = (query: string) => searchBaselineLinesCore(owner, { contractId: big.contractId, query });
    const first = pageOf(await search(''));
    expect(first.lines).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(COST_KEYS);
    expect(pageOf(await search('Line 3.7')).lines.map((line) => line.descriptionEn)).toHaveLength(11);
    expect(pageOf(await search('بند 3.7')).lines).toHaveLength(11);
    expect(pageOf(await search('_')).lines).toHaveLength(0);
    expect(pageOf(await search('%')).lines).toHaveLength(0);
    expect((await search('x'.repeat(5000))).ok).toBe(true);
  });

  it('answers only who sees the picker, and only their own studio', async () => {
    const input = { contractId: big.contractId, query: '' };
    expect(await searchBaselineLinesCore(viewer, input)).toEqual({ ok: false, error: 'forbidden' });
    expect(await searchBaselineLinesCore(projectManager, input)).toEqual({ ok: false, error: 'forbidden' });
    expect(await searchBaselineLinesCore(owner, { contractId: big.contractId, query: 3 })).toEqual({
      ok: false,
      error: 'malformed',
    });
    expect(pageOf(await searchBaselineLinesCore(stranger, input))).toEqual({ lines: [], hasMore: false });
  });
});
