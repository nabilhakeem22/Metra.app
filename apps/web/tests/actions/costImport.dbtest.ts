import { afterAll, describe, expect, it } from 'vitest';
import type { ColumnMapping } from '@/lib/price-book/import';
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
