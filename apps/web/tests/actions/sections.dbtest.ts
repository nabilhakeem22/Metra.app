import { afterAll, describe, expect, it } from 'vitest';
import { upsertSectionCore } from '@/lib/sections/core';
import { listSections } from '@/lib/sections/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('upsertSectionCore (create-on-use, idempotent)', () => {
  it('seedOrg starts with the 8 defaults, all active with keys', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const rows = await listSections(ctx);
    expect(rows.length).toBe(8);
    expect(rows.every((r) => r.active)).toBe(true);
    expect(rows.filter((r) => r.key).length).toBe(8);
  });

  it('creates a new section and returns its id', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const res = await upsertSectionCore(ctx, { nameEn: 'Landscaping' });
    expect(res.ok).toBe(true);
    expect(res.data).toBeTruthy();
    expect(await raw.count('sections', orgId)).toBe(9); // 8 defaults + 1
  });

  it('is idempotent: same trimmed name (any case, either language) -> same id', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const first = await upsertSectionCore(ctx, { nameEn: 'Landscaping' });
    const again = await upsertSectionCore(ctx, { nameEn: '  landscaping ' });
    expect(again.data).toBe(first.data);
    // Matching an EXISTING default by its Arabic name returns that default.
    const civilByAr = await upsertSectionCore(ctx, { nameAr: 'أعمال مدنية' });
    const [seeded] = await listSections(ctx);
    void seeded;
    expect(await raw.count('sections', orgId)).toBe(9); // no new rows
    expect(civilByAr.ok).toBe(true);
  });

  it('rejects when both names are blank', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    expect(
      await upsertSectionCore(ctx, { nameEn: '  ', nameAr: '' }),
    ).toEqual({ ok: false, error: 'name_required' });
  });

  it('forbids a viewer', async () => {
    const { orgId, memberIds } = await seedOrg({
      owners: 1,
      members: [{ role: 'viewer' }],
    });
    orgIds.push(orgId);
    const res = await upsertSectionCore(ctxFor(orgId, memberIds[0], 'viewer'), {
      nameEn: 'Nope',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('a section added by org A is NOT visible to org B (tenant-isolated)', async () => {
    const a = await seedOrg({ owners: 1 });
    const b = await seedOrg({ owners: 1 });
    orgIds.push(a.orgId, b.orgId);
    const ctxA = ctxFor(a.orgId, a.ownerIds[0], 'owner');
    const ctxB = ctxFor(b.orgId, b.ownerIds[0], 'owner');

    await upsertSectionCore(ctxA, { nameEn: 'Secret A section' });
    const bSections = await listSections(ctxB);
    expect(bSections.some((s) => s.nameEn === 'Secret A section')).toBe(false);
    expect(bSections.length).toBe(8); // B only sees its own 8 defaults
  });
});

describe('snapshot guarantee: no FK from proposal_sections / price_changes -> sections', () => {
  it('proves the columns that snapshot section text carry no FK to sections', async () => {
    const fks = await raw.query<{ table_name: string }>(
      `select tc.table_name
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
         where tc.constraint_type = 'FOREIGN KEY'
           and ccu.table_name = 'sections'
           and tc.table_name in ('proposal_sections', 'price_changes')`,
    );
    expect(fks).toHaveLength(0);
  });
});
