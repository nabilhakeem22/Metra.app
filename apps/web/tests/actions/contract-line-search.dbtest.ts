// The variation form's baseline-line picker (PR B1 fix round): every typed word
// matched, folded as every search in the app folds, in the line or its
// section's title; 50 per answer and paged on, so every line can be found and
// picked (F1, F2, F4); a contract or cursor that is not the caller's refused.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchBaselineLinesCore } from '@/lib/contracts/lines-core';
import type { ContractLineOptionsPage } from '@/lib/contracts/queries';
import type { OrgContext } from '@/lib/db/context';
import { createVariationDraftCore, saveVariationDraftCore } from '@/lib/variations/core';
import { seedContractShell, seedGridContract, seedSections } from './contract-lines-fixture';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const NOT_FOUND = { ok: false, error: 'record_not_found' };
let owner: OrgContext;
let viewer: OrgContext;
let projectManager: OrgContext;
let stranger: OrgContext;
let grid: string;
let rooms: string;
let words: string;

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1, members: [{ role: 'viewer' }, { role: 'project_manager' }] });
  const other = await seedOrg({ owners: 1 });
  orgIds.push(studio.orgId, other.orgId);
  owner = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
  viewer = ctxFor(studio.orgId, studio.memberIds[0], 'viewer');
  projectManager = ctxFor(studio.orgId, studio.memberIds[1], 'project_manager');
  stranger = ctxFor(other.orgId, other.ownerIds[0], 'owner');
  grid = (await seedGridContract(studio.orgId, 1, 20, 100)).contractId;
  // The tester's 60 identical rooms: the same paint line in every room, then its door.
  rooms = await seedContractShell(studio.orgId, 2);
  await seedSections(
    studio.orgId,
    rooms,
    Array.from({ length: 60 }, (_, room) => ({
      titleAr: `غرفة ${room + 1}`,
      titleEn: `Room ${room + 1}`,
      sortOrder: room,
      lines: [
        { descriptionAr: 'دهان حوائط بلاستيك ثلاث أوجه', descriptionEn: 'Wall paint, plastic, three coats', sortOrder: 0 },
        { descriptionAr: `باب غرفة رقم ${room + 1}`, descriptionEn: `Door for room ${room + 1}`, sortOrder: 1 },
      ],
    })),
  );
  await raw.query(`update public.contracts set status = 'issued' where id = '${rooms}'`);
  words = await seedContractShell(studio.orgId, 3);
  const phrases: Array<[string, string | null]> = [
    ['إزالة بلاط الأرضيات القديمة', null],
    ['أعمال الدهانات للحوائط', 'Wall painting works'],
    ['تركيب مرآة الحمام', 'Bathroom mirror'],
    ['توريد آلة خلط', 'Mixer machine'],
    ['دهان واجهة المبنى', 'Facade painting'],
    ['عزل مائي للأسطح', 'Roof waterproofing'],
  ];
  await seedSections(studio.orgId, words, [
    {
      titleAr: 'أعمال عامة',
      titleEn: 'General',
      sortOrder: 0,
      lines: phrases.map(([descriptionAr, descriptionEn], sortOrder) => ({ descriptionAr, descriptionEn, sortOrder })),
    },
  ]);
});

const search = async (contractId: string, query: string, afterLineId: string | null = null) => {
  const result = await searchBaselineLinesCore(owner, { contractId, query, afterLineId });
  expect(result.ok).toBe(true);
  return result.data!;
};

/** Every answer for `query`, paged to its end. */
async function everyMatch(contractId: string, query: string): Promise<ContractLineOptionsPage['lines']> {
  const all: ContractLineOptionsPage['lines'] = [];
  for (let request = 0; request < 10; request += 1) {
    const page = await search(contractId, query, all.length > 0 ? all[all.length - 1].id : null);
    expect(page.lines.length).toBeLessThanOrEqual(50);
    all.push(...page.lines);
    if (!page.hasMore) return all;
  }
  throw new Error('more than 10 pages');
}

describe('every line can be found and picked (F1)', () => {
  it('60 identical lines: "more results" reaches all 60, then the 60 doors, in document order', async () => {
    const paint = await everyMatch(rooms, 'دهان حوائط');
    expect(paint).toHaveLength(60);
    expect(new Set(paint.map((line) => line.id)).size).toBe(60);
    expect(paint.map((line) => line.sectionTitleEn)).toEqual(Array.from({ length: 60 }, (_, room) => `Room ${room + 1}`));
    const everything = await everyMatch(rooms, '');
    expect(everything).toHaveLength(120);
    const expected = await raw.query<{ id: string }>(
      `select l.id from public.contract_lines l join public.contract_sections s on s.id = l.section_id
       where l.contract_id = '${rooms}' order by s.sort_order, s.id, l.sort_order, l.id`,
    );
    expect(everything.map((line) => line.id)).toEqual(expected.map((row) => row.id));
  });

  it("the section title narrows: room 60's paint line is found by its room, and a variation names it", async () => {
    const found = await search(rooms, 'دهان غرفة 60');
    expect(found.lines.map((line) => [line.descriptionAr, line.sectionTitleAr])).toEqual([
      ['دهان حوائط بلاستيك ثلاث أوجه', 'غرفة 60'],
    ]);
    expect((await search(rooms, 'Room 55')).lines.map((line) => line.sectionTitleEn)).toEqual(['Room 55', 'Room 55']);
    const draft = await createVariationDraftCore(owner, { contractId: rooms, titleEn: 'Room 60 repaint' });
    const saved = await saveVariationDraftCore(owner, {
      id: (draft as { data?: string }).data!,
      lines: [{ contractLineId: found.lines[0].id, descriptionEn: 'Repaint', qty: '2', unit: 'sqm', unitCost: '0', unitPrice: '80', discountPct: '0' }],
    });
    expect(saved.ok).toBe(true);
    const [stored] = await raw.query<{ contract_line_id: string }>(
      `select contract_line_id from public.variation_order_lines where variation_order_id = '${(draft as { data?: string }).data}'`,
    );
    expect(stored.contract_line_id).toBe(found.lines[0].id);
  });
});

describe('words match as a studio types them (F2, F4)', () => {
  it.each([
    ['ازالة', 'إزالة بلاط الأرضيات القديمة'],
    ['إزاله', 'إزالة بلاط الأرضيات القديمة'],
    ['القديمه', 'إزالة بلاط الأرضيات القديمة'],
    ['اعمال الدهانات', 'أعمال الدهانات للحوائط'],
    ['مراة', 'تركيب مرآة الحمام'],
    ['مرأة', 'تركيب مرآة الحمام'],
    ['الة خلط', 'توريد آلة خلط'],
    ['المبني', 'دهان واجهة المبنى'],
    ['للاسطح', 'عزل مائي للأسطح'],
    ['Wall works', 'أعمال الدهانات للحوائط'],
    ['painting   Wall', 'أعمال الدهانات للحوائط'],
  ])('«%s» finds «%s»', async (query, stored) => {
    expect((await search(words, query)).lines.map((line) => line.descriptionAr)).toEqual([stored]);
  });

  it('folds tatweel and Arabic-Indic digits, and takes % _ \\ literally', async () => {
    expect((await search(words, 'دهـان')).lines).toHaveLength(2);
    // Every word anywhere: «3.7» is in «3.7x» and «13.7x», 22 lines either way it is typed.
    const typedLatin = (await search(grid, 'بند 3.7')).lines.map((line) => line.id);
    expect(typedLatin).toHaveLength(22);
    expect((await search(grid, 'بند ٣.٧')).lines.map((line) => line.id)).toEqual(typedLatin);
    expect((await search(grid, 'بند ٣٫٧')).lines.map((line) => line.id)).toEqual(typedLatin);
    for (const literal of ['%', '_', String.fromCharCode(92)]) expect((await search(grid, literal)).lines).toHaveLength(0);
  });

  it('a NUL in the query is dropped, not a database error (S2)', async () => {
    expect((await search(grid, `Line 3.7${String.fromCharCode(0)}`)).lines).toHaveLength(22);
    expect((await search(grid, 'x'.repeat(5000))).lines).toHaveLength(0);
  });
});

describe('who may search, and where', () => {
  it('only who sees the picker; a contract or cursor that is not the caller\'s is refused, as an unknown one is', async () => {
    const input = { contractId: grid, query: '', afterLineId: null };
    expect(await searchBaselineLinesCore(viewer, input)).toEqual({ ok: false, error: 'forbidden' });
    expect(await searchBaselineLinesCore(projectManager, input)).toEqual({ ok: false, error: 'forbidden' });
    expect(await searchBaselineLinesCore(owner, { ...input, query: 3 })).toEqual({ ok: false, error: 'malformed' });
    expect(await searchBaselineLinesCore(owner, { ...input, afterLineId: {} })).toEqual({ ok: false, error: 'malformed' });
    expect(await searchBaselineLinesCore(stranger, input)).toEqual(NOT_FOUND);
    expect(await searchBaselineLinesCore(owner, { ...input, contractId: randomUUID() })).toEqual(NOT_FOUND);
    const [roomsLine] = await raw.query<{ id: string }>(`select id from public.contract_lines where contract_id = '${rooms}' limit 1`);
    expect(await searchBaselineLinesCore(owner, { ...input, afterLineId: roomsLine.id })).toEqual(NOT_FOUND);
    expect(await search(grid, 'no such words here')).toEqual({ lines: [], hasMore: false });
  });
});
