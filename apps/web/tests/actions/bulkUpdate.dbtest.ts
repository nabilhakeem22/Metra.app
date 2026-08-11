import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { bulkUpdatePricesCore, loadStarterCatalogueCore } from '@/lib/price-book/bulk-core';
import { createCostItemCore } from '@/lib/price-book/core';
import { listCostItems } from '@/lib/price-book/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('bulkUpdatePricesCore — piastre-exact', () => {
  it('applies +15% to a category in SQL, records history, touches nothing else', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');

    await createCostItemCore(ctx, {
      code: 'CIV-A',
      nameEn: 'Round', category: 'civil', unit: 'sqm',
      defaultUnitCost: '100.0000', defaultUnitPrice: '200.0000',
    });
    await createCostItemCore(ctx, {
      code: 'CIV-B',
      nameEn: 'Third', category: 'civil', unit: 'sqm',
      defaultUnitCost: '33.3333', defaultUnitPrice: '33.3333',
    });
    await createCostItemCore(ctx, {
      code: 'GYP-A',
      nameEn: 'Other', category: 'gypsum', unit: 'sqm',
      defaultUnitCost: '500.0000', defaultUnitPrice: '500.0000',
    });

    const res = await bulkUpdatePricesCore(ctx, {
      category: 'civil',
      pct: 15,
      target: 'both',
    });
    expect(res.ok).toBe(true);
    expect(res.data?.itemCount).toBe(2);

    const items = await listCostItems(ctx, {});
    const byCode = Object.fromEntries(items.map((i) => [i.code, i]));
    // 100 * 1.15 = 115.0000 ; 200 * 1.15 = 230.0000
    expect(byCode['CIV-A'].defaultUnitCost).toBe('115.0000');
    expect(byCode['CIV-A'].defaultUnitPrice).toBe('230.0000');
    // 33.3333 * 1.15 = 38.333295 -> round(,4) = 38.3333
    expect(byCode['CIV-B'].defaultUnitCost).toBe('38.3333');
    expect(byCode['CIV-B'].defaultUnitPrice).toBe('38.3333');
    // gypsum untouched
    expect(byCode['GYP-A'].defaultUnitCost).toBe('500.0000');
    expect(byCode['GYP-A'].defaultUnitPrice).toBe('500.0000');

    // History written: 1 header + 2 lines.
    expect(await raw.count('price_changes', orgId)).toBe(1);
    expect(await raw.count('price_change_lines', orgId)).toBe(2);
  });

  it('rejects an out-of-range percentage', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    expect(
      await bulkUpdatePricesCore(ctx, { category: 'civil', pct: 2000, target: 'both' }),
    ).toEqual({ ok: false, error: 'invalid_percentage' });
    expect(
      await bulkUpdatePricesCore(ctx, { category: 'civil', pct: -150, target: 'cost' }),
    ).toEqual({ ok: false, error: 'invalid_percentage' });
  });

  it('forbids a project_manager (read-only) from bulk updating', async () => {
    const { orgId, memberIds } = await seedOrg({
      owners: 1,
      members: [{ role: 'project_manager' }],
    });
    orgIds.push(orgId);
    const res = await bulkUpdatePricesCore(
      ctxFor(orgId, memberIds[0], 'project_manager'),
      { category: 'civil', pct: 10, target: 'both' },
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('price history is append-only', () => {
  it('metra_app cannot UPDATE or DELETE price_changes / price_change_lines', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await createCostItemCore(ctx, {
      code: 'H-1', nameEn: 'H', category: 'civil', unit: 'sqm',
      defaultUnitCost: '10', defaultUnitPrice: '20',
    });
    await bulkUpdatePricesCore(ctx, { category: 'civil', pct: 5, target: 'both' });

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(sql`update public.price_changes set item_count = 999`),
      ),
    ).rejects.toThrow();
    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(sql`delete from public.price_change_lines`),
      ),
    ).rejects.toThrow();
  });
});

describe('loadStarterCatalogueCore — idempotent', () => {
  it('loads 40 items once, then is a no-op', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');

    const first = await loadStarterCatalogueCore(ctx);
    expect(first.data?.inserted).toBe(40);
    expect(first.data?.total).toBe(40);

    const second = await loadStarterCatalogueCore(ctx);
    expect(second.data?.inserted).toBe(0);

    expect(await raw.count('cost_items', orgId)).toBe(40);
  });
});
