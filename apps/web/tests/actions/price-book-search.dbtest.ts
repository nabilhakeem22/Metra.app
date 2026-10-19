import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { findExistingCodesCore } from '@/lib/price-book/import-existing';
import { searchPriceBookPickerCore } from '@/lib/price-book/picker-core';
import { hasActiveCostItem, searchPickerItems } from '@/lib/price-book/picker-query';
import { PICKER_LIMIT } from '@/lib/price-book/picker-types';
import { searchForm } from '@/lib/search/fold';
import { searchFormSql } from '@/lib/search/words-sql';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// The SQL half of the price book's search: it folds what it compares exactly as
// searchForm does (so the page and a list searched in the browser agree), the
// builder's picker is answered from it on demand, and the import preview asks
// which codes exist instead of carrying the whole book.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

async function studio() {
  const { orgId, ownerIds } = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  orgIds.push(orgId);
  return { orgId, ctx: ctxFor(orgId, ownerIds[0], 'owner') };
}

async function item(orgId: string, sectionId: string, code: string, nameEn: string, nameAr: string, active = true) {
  await raw.query(
    `insert into public.cost_items (org_id, code, name_en, name_ar, section_id, unit, active) values ('${orgId}', ${quote(code)}, ${quote(nameEn)}, ${quote(nameAr)}, '${sectionId}', 'sqm', ${active})`,
  );
}

const MARKS = ['࢘', '࢟', 'َ', 'ّ', 'ٰ', 'ۡ', 'ـ', '‏', '​', '؜', '­', '﻿', '́'];
const CORPUS = [
  'مواسير بولى بروبلين', 'مواسير بولی  بروبلين', 'مَوَاسِيـر بُولِي', 'أإآ ة ى ی ک', 'نحاس ٢ مم', 'نحاس ۲ مم', '٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹',
  'Gypsum BOARD', 'ﻻ ﷲ ﺑ', 'Café', 'café', 'MKT-finishing.glass_4mm', ...MARKS.map((mark) => `س${mark}ل`),
];

describe('searchFormSql', () => {
  it('folds every sample as searchForm does (whitespace aside: a searched word holds none)', async () => {
    const { ctx } = await studio();
    const folded = await withOrgContext(ctx, (tx) =>
      Promise.all(CORPUS.map(async (text) => ((await tx.execute(sql`select ${searchFormSql(sql`${text}::text`)} as f`)) as unknown as Array<{ f: string }>)[0].f)),
    );
    const words = (text: string) => text.split(/\s+/).filter(Boolean);
    expect(folded.map(words)).toEqual(CORPUS.map((text) => words(searchForm(text))));
  });
});

describe('searchPickerItems', () => {
  it('answers at most PICKER_LIMIT active items, counts every match, and lists a retired section last', async () => {
    const { orgId, ctx } = await studio();
    const civil = await raw.sectionId(orgId);
    const [retired] = await raw.query<{ id: string }>(`insert into public.sections (org_id, name_en, name_ar, active) values ('${orgId}', 'Old', 'قديم', false) returning id`);
    for (let n = 0; n < 40; n += 1) await item(orgId, civil, `C-${n}`, `Board ${n}`, `لوح ${n}`);
    await item(orgId, civil, 'C-off', 'Board retired', 'لوح متوقف', false);
    await item(orgId, retired.id, 'O-1', 'Board old', 'لوح قديم');

    const first = await searchPickerItems(ctx, '', 'en', true);
    expect(first.items).toHaveLength(PICKER_LIMIT);
    expect(first.matched).toBe(41);
    expect(first.items.slice(0, 3).map((row) => row.code)).toEqual(['C-0', 'C-1', 'C-2']);

    const one = await searchPickerItems(ctx, 'board 39', 'en', true);
    expect(one.items.map((row) => row.code)).toEqual(['C-39']);
    const lastOfAll = await searchPickerItems(ctx, 'old', 'en', true);
    expect(lastOfAll.items).toEqual([expect.objectContaining({ code: 'O-1', sectionId: null })]);
    expect((await searchPickerItems(ctx, 'متوقف', 'ar-EG', true)).matched).toBe(0);
    expect(await hasActiveCostItem(ctx)).toBe(true);
  });

  it('only a role that may edit a draft is answered, and only a role that may see cost gets the cost', async () => {
    const { orgId, ctx } = await studio();
    await item(orgId, await raw.sectionId(orgId), 'C-1', 'Board', 'لوح');
    const as = (role: 'owner' | 'project_manager' | 'viewer' | 'site_engineer' | 'accountant') => ({ ...ctx, role });
    for (const role of ['viewer', 'site_engineer', 'accountant'] as const) {
      expect(await searchPriceBookPickerCore(as(role), '', 'en')).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(await searchPriceBookPickerCore(as('owner'), 'board', 'fr')).toEqual({ ok: false, error: 'malformed' });
    const owner = await searchPriceBookPickerCore(as('owner'), 'board', 'en');
    expect(owner.data?.items[0]).toMatchObject({ code: 'C-1', defaultUnitCost: '0.0000' });
    expect((await searchPriceBookPickerCore(as('project_manager'), 'board', 'en')).data?.items[0]).toMatchObject({ defaultUnitCost: '0.0000' });
    // With the margin hidden from PMs, a PM still picks the item; its cost stays in the price book.
    await raw.query(`update public.organizations set hide_margin_from_pm = true where id = '${orgId}'`);
    const pm = await searchPriceBookPickerCore(as('project_manager'), 'board', 'en');
    expect(pm.data?.items[0]).toMatchObject({ code: 'C-1', defaultUnitCost: null, defaultUnitPrice: '0.0000' });
  });

  it('every typed word narrows: a full bulletin name finds that item, not its sibling (F3)', async () => {
    const { orgId, ctx } = await studio();
    const civil = await raw.sectionId(orgId);
    const standard = 'ألواح كلادينج، 4 مم سمك رقتين الألومينيوم 0.3 مم ألوان عادة';
    await item(orgId, civil, 'CLAD-1', 'Aluminium composite cladding panel, 4 mm, standard colours', standard);
    await item(orgId, civil, 'CLAD-2', 'Aluminium composite cladding panel, 4 mm, wood colours', standard.replace('ألوان عادة', 'ألوان خشبية'));
    expect((await searchPickerItems(ctx, standard, 'ar-EG', true)).items.map((row) => row.code)).toEqual(['CLAD-1']);
    expect((await searchPickerItems(ctx, 'cladding panel 4 mm aluminium composite colours wood', 'en', true)).items.map((row) => row.code)).toEqual(['CLAD-2']);
    expect((await searchPickerItems(ctx, 'cladding panel 4 mm aluminium composite colours wood zzzz', 'en', true)).matched).toBe(0);
  });

  it('a studio with no active item has no picker', async () => {
    const { orgId, ctx } = await studio();
    await item(orgId, await raw.sectionId(orgId), 'X-1', 'Retired', 'متوقف', false);
    expect(await hasActiveCostItem(ctx)).toBe(false);
  });
});

describe('findExistingCodesCore', () => {
  it('names the sheet codes the book already has, case-SENSITIVE, and nothing of another studio', async () => {
    const mine = await studio();
    const theirs = await studio();
    await item(mine.orgId, await raw.sectionId(mine.orgId), 'ABC', 'Mine', 'بتاعي');
    await item(theirs.orgId, await raw.sectionId(theirs.orgId), 'XYZ', 'Theirs', 'بتاعهم');
    expect(await findExistingCodesCore(mine.ctx, ['ABC', 'abc', 'XYZ', '', 'NEW'])).toEqual({ ok: true, data: ['ABC'] });
  });

  it('refuses a role that cannot import, and a malformed or oversized question', async () => {
    const { orgId } = await studio();
    const [pm] = await raw.query<{ user_id: string }>(`select user_id from public.memberships where org_id = '${orgId}' and role = 'project_manager'`);
    const owner = ctxFor(orgId, (await raw.memberships(orgId)).find((m) => m.role === 'owner')!.user_id, 'owner');
    expect(await findExistingCodesCore(ctxFor(orgId, pm.user_id, 'project_manager'), ['A'])).toEqual({ ok: false, error: 'forbidden' });
    expect(await findExistingCodesCore(owner, 'A')).toEqual({ ok: false, error: 'malformed' });
    expect(await findExistingCodesCore(owner, [1, 2])).toEqual({ ok: false, error: 'malformed' });
    expect(await findExistingCodesCore(owner, Array.from({ length: 2001 }, (_, n) => `C-${n}`))).toEqual({ ok: false, error: 'malformed' });
  });
});
