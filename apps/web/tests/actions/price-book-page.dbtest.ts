import { afterAll, describe, expect, it } from 'vitest';
import { bulkUpdatePricesCore } from '@/lib/price-book/bulk-core';
import { FIRST_VIEW, PRICE_BOOK_PAGE_SIZE, type PriceBookView } from '@/lib/price-book/page-params';
import { listPriceBookPage } from '@/lib/price-book/page-query';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// The price book page, paged, filtered and searched IN POSTGRES (R2: a 447-item
// book rendered whole cost 3.6x an empty page). One page of rows, every item on
// exactly one page, in the order the page always had: sections, then items, by
// name in the page's language, numbers inside names compared as numbers.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

async function section(orgId: string, nameEn: string, nameAr: string, active = true): Promise<string> {
  const [row] = await raw.query<{ id: string }>(
    `insert into public.sections (org_id, name_en, name_ar, active) values ('${orgId}', ${quote(nameEn)}, ${quote(nameAr)}, ${active}) returning id`,
  );
  return row.id;
}

async function items(orgId: string, sectionId: string, rows: Array<{ code: string; nameEn: string; nameAr: string; active?: boolean }>) {
  const values = rows
    .map((r) => `('${orgId}', ${quote(r.code)}, ${quote(r.nameEn)}, ${quote(r.nameAr)}, '${sectionId}', 'sqm', 10, 20, ${r.active ?? true})`)
    .join(', ');
  await raw.query(
    `insert into public.cost_items (org_id, code, name_en, name_ar, section_id, unit, default_unit_cost, default_unit_price, active) values ${values}`,
  );
}

async function studio() {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  return { orgId, ctx: ctxFor(orgId, ownerIds[0], 'owner') };
}

const view = (change: Partial<PriceBookView>): PriceBookView => ({ ...FIRST_VIEW, ...change });
const codes = (page: { rows: Array<{ code: string }> }) => page.rows.map((row) => row.code);

describe('listPriceBookPage', () => {
  it('pages a 120-item book 50 at a time: every item on exactly one page, ordered by name with numbers as numbers', async () => {
    const { orgId, ctx } = await studio();
    const glass = await section(orgId, 'Glass', 'الزجاج');
    await items(orgId, glass, Array.from({ length: 120 }, (_, n) => ({ code: `G-${n}`, nameEn: `Pane ${n + 1} mm`, nameAr: `لوح ${n + 1} مم` })));

    const pages = await Promise.all([1, 2, 3].map((page) => listPriceBookPage(ctx, view({ page }), 'en')));
    expect(pages.map((page) => page.rows.length)).toEqual([PRICE_BOOK_PAGE_SIZE, PRICE_BOOK_PAGE_SIZE, 20]);
    expect(pages[0]).toMatchObject({ matched: 120, pageCount: 3, hasAnyItem: true, sectionCounts: { [glass]: 120 } });
    const all = pages.flatMap(codes);
    expect(new Set(all).size).toBe(120);
    expect(all.slice(0, 3)).toEqual(['G-0', 'G-1', 'G-2']);
    expect(all.at(-1)).toBe('G-119');

    const arabic = await listPriceBookPage(ctx, view({}), 'ar-EG');
    expect(codes(arabic).slice(0, 3)).toEqual(['G-0', 'G-1', 'G-2']);
  });

  it('a page past the end shows the last page; sections order by name in the page language', async () => {
    const { orgId, ctx } = await studio();
    const zinc = await section(orgId, 'A first in English', 'ياء');
    const alef = await section(orgId, 'Z last in English', 'ألف');
    await items(orgId, zinc, [{ code: 'Y-1', nameEn: 'Ya item', nameAr: 'بند ياء' }]);
    await items(orgId, alef, [{ code: 'A-1', nameEn: 'Alef item', nameAr: 'بند ألف' }]);

    expect(codes(await listPriceBookPage(ctx, view({}), 'en'))).toEqual(['Y-1', 'A-1']);
    expect(codes(await listPriceBookPage(ctx, view({}), 'ar-EG'))).toEqual(['A-1', 'Y-1']);
    expect(await listPriceBookPage(ctx, view({ page: 9 }), 'en')).toMatchObject({ page: 1, pageCount: 1 });
  });

  it('filters by section and by active in SQL, and never lists an item under a retired section', async () => {
    const { orgId, ctx } = await studio();
    const glass = await section(orgId, 'Glass', 'الزجاج');
    const paint = await section(orgId, 'Paint', 'دهانات');
    const retired = await section(orgId, 'Old', 'قديم', false);
    await items(orgId, glass, [{ code: 'G-1', nameEn: 'Clear glass', nameAr: 'زجاج شفاف' }, { code: 'G-2', nameEn: 'Tinted glass', nameAr: 'زجاج ملون', active: false }]);
    await items(orgId, paint, [{ code: 'P-1', nameEn: 'Emulsion', nameAr: 'دهان بلاستيك' }]);
    await items(orgId, retired, [{ code: 'O-1', nameEn: 'Old thing', nameAr: 'حاجة قديمة' }]);

    expect(codes(await listPriceBookPage(ctx, view({}), 'en'))).toEqual(['G-1', 'G-2', 'P-1']);
    expect(codes(await listPriceBookPage(ctx, view({ sectionId: glass }), 'en'))).toEqual(['G-1', 'G-2']);
    expect(codes(await listPriceBookPage(ctx, view({ activeOnly: true }), 'en'))).toEqual(['G-1', 'P-1']);
    expect(await listPriceBookPage(ctx, view({ sectionId: glass, activeOnly: true }), 'en')).toMatchObject({ matched: 1, sectionCounts: { [glass]: 1 } });
  });

  it('searches the code and both names, every word in any order, Arabic spellings and digits folded (P1)', async () => {
    const { orgId, ctx } = await studio();
    const civil = await section(orgId, 'Civil', 'مدني');
    await items(orgId, civil, [
      { code: 'MKT-w', nameEn: 'Insulated copper wire 2 mm', nameAr: 'أسلاك نحاس معزول 2 مم' },
      { code: 'MKT-v', nameEn: 'Insulated copper wire 6 mm', nameAr: 'أسلاك نحاس معزول 6 مم' },
      { code: 'MKT-p', nameEn: 'PP pipe', nameAr: 'مواسير بولى بروبلين مرنة' },
      { code: 'GYP-001', nameEn: 'Gypsum board', nameAr: 'جبسوم بورد' },
    ]);
    const search = async (query: string) => codes(await listPriceBookPage(ctx, view({ query }), 'en')).sort();

    expect(await search('gyp-00')).toEqual(['GYP-001']);
    expect(await search('GYPSUM')).toEqual(['GYP-001']);
    expect(await search('جبسوم')).toEqual(['GYP-001']);
    expect(await search('بولي')).toEqual(['MKT-p']);
    expect(await search('مرنه')).toEqual(['MKT-p']);
    expect(await search('مَواسيـر')).toEqual(['MKT-p']);
    expect(await search('نحاس معزول ٢ مم')).toEqual(['MKT-w']);
    expect(await search('نحاس ۲')).toEqual(['MKT-w']);
    expect(await search('معزول نحاس')).toEqual(['MKT-v', 'MKT-w']);
    expect(await search('wire copper 6')).toEqual(['MKT-v']);
    expect(await search("%' _")).toEqual([]);
    expect(await search('   ')).toHaveLength(4);
  });

  it('tells an empty book from a filter that matched nothing, and shows no other studio s items', async () => {
    const empty = await studio();
    expect(await listPriceBookPage(empty.ctx, view({}), 'en')).toMatchObject({ rows: [], matched: 0, hasAnyItem: false });

    const other = await studio();
    await items(other.orgId, await section(other.orgId, 'Glass', 'الزجاج'), [{ code: 'X-1', nameEn: 'Theirs', nameAr: 'بتاعهم' }]);
    expect(await listPriceBookPage(empty.ctx, view({ query: 'theirs' }), 'en')).toMatchObject({ matched: 0, hasAnyItem: false });
    expect(await listPriceBookPage(other.ctx, view({ query: 'nothing like it' }), 'en')).toMatchObject({ matched: 0, hasAnyItem: true });
  });
});

describe('a bulk price change on a paged book', () => {
  it('changes EVERY item of the section, not the page on screen', async () => {
    const { orgId, ctx } = await studio();
    const glass = await section(orgId, 'Glass', 'الزجاج');
    await items(orgId, glass, Array.from({ length: 70 }, (_, n) => ({ code: `G-${n}`, nameEn: `Pane ${n}`, nameAr: `لوح ${n}`, active: n % 7 !== 0 })));
    const res = await bulkUpdatePricesCore(ctx, { sectionId: glass, pct: '10', target: 'price' });
    expect(res.data?.itemCount).toBe(70);
    const [{ n }] = await raw.query<{ n: number }>(`select count(*)::int as n from public.cost_items where org_id = '${orgId}' and default_unit_price = 22`);
    expect(n).toBe(70);
  });
});
