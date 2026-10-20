import { afterAll, describe, expect, it } from 'vitest';
import type { ColumnMapping } from '@/lib/price-book/import';
import { updateCostItemCore } from '@/lib/price-book/core';
import { importCostItemsCore } from '@/lib/price-book/import-core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// columns: [code, nameEn, category, unit, cost, price]
const MAPPING: ColumnMapping = {
  code: 0,
  nameEn: 1,
  category: 2,
  unit: 3,
  cost: 4,
  price: 5,
};

function validRow(code: string): string[] {
  return [code, `Item ${code}`, 'civil', 'sqm', '100', '150'];
}

describe('importCostItemsCore — 500-row partial import', () => {
  it('imports valid rows, skips the rest by index, never rejects the file', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');

    // Pre-seed 50 codes so they collide on the big import.
    const seedRows = Array.from({ length: 50 }, (_, i) =>
      validRow(`EX-${i}`),
    );
    const first = await importCostItemsCore(ctx, {
      rows: seedRows,
      mapping: MAPPING,
    });
    expect(first.ok).toBe(true);
    expect(first.data?.imported).toBe(50);

    // Build 500 rows: 0..49 existing (code_exists), 50 bad category,
    // 51 missing name, 52..499 new (imported).
    const rows: string[][] = [];
    for (let i = 0; i < 50; i += 1) rows.push(validRow(`EX-${i}`));
    rows.push(['BADCAT', 'Bad category', 'not_a_category', 'sqm', '1', '2']); // 50
    rows.push(['NONAME', '', 'civil', 'sqm', '1', '2']); // 51
    for (let i = 52; i < 500; i += 1) rows.push(validRow(`NEW-${i}`));
    expect(rows).toHaveLength(500);

    const res = await importCostItemsCore(ctx, { rows, mapping: MAPPING });
    expect(res.ok).toBe(true);
    const s = res.data!;
    expect(s.total).toBe(500);
    expect(s.imported + s.skipped).toBe(500);
    expect(s.imported).toBe(448); // 500 - 50 existing - 2 invalid
    expect(s.skipped).toBe(52);

    // Per-row errors are addressable by index.
    expect(s.results[0].error).toBe('code_exists');
    expect(s.results[49].error).toBe('code_exists');
    expect(s.results[50].error).toBe('category_invalid');
    expect(s.results[51].error).toBe('name_missing');
    expect(s.results[52].ok).toBe(true);

    // DB reflects exactly the imported rows (50 seed + 448 new).
    expect(await raw.count('cost_items', orgId)).toBe(498);
  });

  it('flags duplicate codes within the same file', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const rows = [validRow('SAME'), validRow('SAME')];
    const res = await importCostItemsCore(ctx, { rows, mapping: MAPPING });
    expect(res.data?.imported).toBe(1);
    expect(res.data?.results[1].error).toBe('code_duplicate_in_file');
  });
});

describe('a long imported item stays editable (N1)', () => {
  it('imports a long row within the caps, refuses one past them, and edits the price of each without touching its text', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const sectionId = await raw.sectionId(orgId);
    const longName = 'Supply, fabricate and install tempered laminated glass balustrade with stainless steel fixings. '.repeat(9).trim();
    const longCode = `BOQ-${'1234567890'.repeat(11)}`;
    expect([longName.length > 200, longName.length <= 1000, longCode.length <= 120]).toEqual([true, true, true]);
    const imported = await importCostItemsCore(ctx, {
      rows: [[longCode, longName, 'civil', 'sqm', '100', '120'], [`${longCode}-TOO-LONG`, longName, 'civil', 'sqm', '100', '120']],
      mapping: MAPPING,
    });
    expect(imported).toMatchObject({ ok: true, data: { imported: 1 } });

    // A row stored before the caps: longer than an import or a new item may be today.
    await raw.query(`insert into cost_items (org_id, code, name_en, section_id, unit, default_unit_cost, default_unit_price)
      values ('${orgId}', 'OLD-${'7'.repeat(210)}', '${'Old description '.repeat(80).trim()}', '${sectionId}', 'sqm', 100, 120)`);

    const rows = await raw.query<{ id: string; code: string; name_en: string }>(`select id, code, name_en from cost_items where org_id = '${orgId}' order by code`);
    for (const row of rows) {
      const edit = { id: row.id, code: row.code, nameEn: row.name_en, nameAr: '', sectionId, unit: 'sqm' as const, defaultUnitCost: '100', defaultUnitPrice: '150' };
      expect(await updateCostItemCore(ctx, edit)).toEqual({ ok: true });
      expect(await updateCostItemCore(ctx, { ...edit, nameEn: `${'x'.repeat(1001)}` })).toEqual({
        ok: false, error: 'check_fields', fields: { nameEn: { code: 'too_long', params: { max: 1000 } } },
      });
    }
    const prices = await raw.query<{ price: string }>(`select default_unit_price::text as price from cost_items where org_id = '${orgId}'`);
    expect(prices.map((row) => row.price)).toEqual(['150.0000', '150.0000']);
  });
});
