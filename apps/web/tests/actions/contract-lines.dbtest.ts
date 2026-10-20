// The contract page is bounded whatever the contract's size (PR B1, A27; A3
// reliability R1): its sections come 50 at a time, counted in SQL, the first
// page with at most 50 lines; each section pages 50 lines at a time; a position
// that is not the caller's is refused; and the PDF reads every line in exactly
// the page's order.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContractSectionsCore, loadSectionLinesCore } from '@/lib/contracts/lines-core';
import {
  getContractForPdf,
  getContractSectionsPage,
  type ContractLinesPage,
  type ContractSectionsPage,
} from '@/lib/contracts/queries';
import type { OrgContext } from '@/lib/db/context';
import { seedContractShell, seedGridContract, seedSections } from './contract-lines-fixture';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const COST_KEYS = /unitCost|lineCost|lineMargin|unit_cost|line_cost|line_margin/;
const NOT_FOUND = { ok: false, error: 'record_not_found' };
let owner: OrgContext;
let viewer: OrgContext;
let projectManager: OrgContext;
let stranger: OrgContext;
let big: { contractId: string; sectionIds: string[] };
let small: { contractId: string; sectionIds: string[] };
let tied: string;

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1, members: [{ role: 'viewer' }, { role: 'project_manager' }] });
  const other = await seedOrg({ owners: 1 });
  orgIds.push(studio.orgId, other.orgId);
  owner = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
  viewer = ctxFor(studio.orgId, studio.memberIds[0], 'viewer');
  projectManager = ctxFor(studio.orgId, studio.memberIds[1], 'project_manager');
  stranger = ctxFor(other.orgId, other.ownerIds[0], 'owner');
  big = await seedGridContract(studio.orgId, 1, 20, 100);
  small = await seedGridContract(studio.orgId, 2, 2, 3);
  // Two sections tied on sort_order 8, both of tied lines: only ids order them (F5).
  tied = await seedContractShell(studio.orgId, 3);
  const tiedLines = (name: string) =>
    Array.from({ length: 6 }, (_, g) => ({ descriptionAr: null, descriptionEn: `${name} ${g}`, sortOrder: 0 }));
  await seedSections(studio.orgId, tied, [
    { titleAr: null, titleEn: '8a', sortOrder: 8, lines: tiedLines('a') },
    { titleAr: null, titleEn: '8b', sortOrder: 8, lines: tiedLines('b') },
  ]);
});

const pageOf = (result: { ok: boolean; data?: ContractLinesPage }) => {
  expect(result.ok).toBe(true);
  return result.data!;
};

describe('the contract page opens bounded', () => {
  it('a 2,000-line contract: counts from SQL, the first 50 lines only, no cost', async () => {
    const page = (await getContractSectionsPage(owner, big.contractId, null))!;
    expect(page.sections).toHaveLength(20);
    expect(page.sections.reduce((sum, section) => sum + section.lineCount, 0)).toBe(2000);
    expect(page.sections.map((section) => section.openingLines.length)).toEqual([50, ...Array(19).fill(0)]);
    expect(page.sections[0].openingLines[0].descriptionEn).toBe('Line 0.0');
    expect(page.sections[0].sectionSubtotal).toBe('10000.0000');
    expect(JSON.stringify(page.sections)).not.toMatch(COST_KEYS);
  });

  it('a small contract opens whole', async () => {
    const page = (await getContractSectionsPage(owner, small.contractId, null))!;
    expect(page.sections.map((section) => [section.lineCount, section.openingLines.length])).toEqual([[3, 3], [3, 3]]);
  });

  it('the PDF reads every line, in the page order, ties in sort_order included (F5)', async () => {
    const pdf = (await getContractForPdf(owner, big.contractId, true))!;
    expect(pdf.sections.reduce((sum, section) => sum + section.lines.length, 0)).toBe(2000);
    const pdfTied = (await getContractForPdf(owner, tied, true))!;
    const pageTied = (await getContractSectionsPage(owner, tied, null))!;
    expect(pdfTied.sections.map((section) => section.id)).toEqual(pageTied.sections.map((section) => section.id));
    const expected = await raw.query<{ id: string }>(
      `select l.id from public.contract_lines l join public.contract_sections s on s.id = l.section_id
       where l.contract_id = '${tied}' order by s.sort_order, s.id, l.sort_order, l.id`,
    );
    expect(pdfTied.sections.flatMap((section) => section.lines.map((line) => line.id))).toEqual(expected.map((row) => row.id));
    expect(pageTied.sections.flatMap((section) => section.openingLines.map((line) => line.id))).toEqual(
      expected.map((row) => row.id),
    );
  });
});

describe('the sections, 50 a request (A3 reliability R1)', () => {
  const sectionsOf = (result: { ok: boolean; data?: ContractSectionsPage }) => {
    expect(result.ok).toBe(true);
    return result.data!;
  };

  it('walks 120 sections of tied sort orders: every section once, in order, the opening lines on the first page only', async () => {
    const wide = await seedContractShell(owner.orgId, 4);
    await seedSections(
      owner.orgId,
      wide,
      Array.from({ length: 120 }, (_, n) => ({
        titleAr: null,
        titleEn: `S${n}`,
        sortOrder: n % 7,
        lines: n % 3 === 0 ? [] : [{ descriptionAr: null, descriptionEn: `L${n}`, sortOrder: 0 }],
      })),
    );
    const seen: string[] = [];
    const counts: number[] = [];
    let afterSectionId: string | null = null;
    const pages: ContractSectionsPage[] = [];
    for (let request = 0; request < 4; request += 1) {
      const page = sectionsOf(await loadContractSectionsCore(owner, { contractId: wide, afterSectionId }));
      pages.push(page);
      seen.push(...page.sections.map((section) => section.id));
      counts.push(...page.sections.map((section) => section.lineCount));
      if (!page.hasMore) break;
      afterSectionId = seen[seen.length - 1];
    }
    expect(pages.map((page) => [page.sections.length, page.hasMore])).toEqual([[50, true], [50, true], [20, false]]);
    const expected = await raw.query<{ id: string; n: number }>(
      `select s.id, (select count(*)::int from public.contract_lines l where l.section_id = s.id) as n
         from public.contract_sections s where s.contract_id = '${wide}' order by s.sort_order, s.id`,
    );
    expect(seen).toEqual(expected.map((row) => row.id));
    expect(counts).toEqual(expected.map((row) => row.n));
    const opening = (page: ContractSectionsPage) => page.sections.reduce((sum, section) => sum + section.openingLines.length, 0);
    expect(pages.map(opening)).toEqual([expected.slice(0, 50).reduce((sum, row) => sum + row.n, 0), 0, 0]);
  });

  it('refuses a cursor of another contract, another studio and a malformed id; nobody but a reader asks', async () => {
    expect(await loadContractSectionsCore(owner, { contractId: big.contractId, afterSectionId: small.sectionIds[0] })).toEqual(NOT_FOUND);
    expect(await loadContractSectionsCore(stranger, { contractId: big.contractId, afterSectionId: null })).toEqual(NOT_FOUND);
    expect(await loadContractSectionsCore(owner, { contractId: randomUUID(), afterSectionId: null })).toEqual(NOT_FOUND);
    expect(await loadContractSectionsCore(owner, { contractId: big.contractId, afterSectionId: 'x' })).toEqual({ ok: false, error: 'malformed' });
    expect(await loadContractSectionsCore(owner, null)).toEqual({ ok: false, error: 'malformed' });
    expect(await loadContractSectionsCore(projectManager, { contractId: big.contractId, afterSectionId: null })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    // The last section is a real cursor with nothing after it: an empty page, not "not found".
    expect(await loadContractSectionsCore(owner, { contractId: big.contractId, afterSectionId: big.sectionIds[19] })).toEqual({
      ok: true,
      data: { sections: [], hasMore: false },
    });
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
    const pastTheEnd = { contractId: big.contractId, sectionId, afterLineId: seen[seen.length - 1] };
    expect(pageOf(await loadSectionLinesCore(owner, pastTheEnd))).toEqual({ lines: [], hasMore: false });
  });

  it('a section, a cursor or a contract that is not the caller\'s is refused, the same as an unknown one (F3)', async () => {
    const firstPage = { contractId: big.contractId, sectionId: big.sectionIds[0], afterLineId: null };
    const [otherSectionLine] = await raw.query<{ id: string }>(
      `select id from public.contract_lines where section_id = '${big.sectionIds[1]}' limit 1`,
    );
    const refused = [
      { ...firstPage, sectionId: small.sectionIds[0] },
      { ...firstPage, afterLineId: otherSectionLine.id },
      { ...firstPage, sectionId: randomUUID() },
      { ...firstPage, afterLineId: randomUUID() },
      { ...firstPage, contractId: randomUUID() },
    ];
    for (const input of refused) expect(await loadSectionLinesCore(owner, input)).toEqual(NOT_FOUND);
    // Another studio (a studio switch in another tab): the same answer, no oracle.
    expect(await loadSectionLinesCore(stranger, firstPage)).toEqual(NOT_FOUND);
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
