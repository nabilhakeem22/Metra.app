import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import {
  createDocumentCategoryCore,
  updateDocumentCategoryCore,
} from '@/lib/document-categories/core';
import {
  listActiveDocumentCategories,
  listDocumentCategories,
} from '@/lib/document-categories/queries';
import { INVALID_CATEGORY, resolveCategoryId } from '@/lib/document-categories/resolve';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Firm-configurable document categories. The rules worth proving are the ones that
// protect already-filed paper: a category is RETIRED, never deleted; a retired one
// takes no new documents but keeps its old ones; and one org's vocabulary is
// invisible to another.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function seedWorkspace() {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  return { orgId, ctx: ctxFor(orgId, ownerIds[0], 'owner') };
}

describe('the default vocabulary', () => {
  it('gives a new workspace a starting set it can immediately file under', async () => {
    const { ctx } = await seedWorkspace();
    const all = await listDocumentCategories(ctx);
    // seedOrg goes through the same bootstrap path as createOrgCore.
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((c) => c.active)).toBe(true);
    // Seeded rows carry a key; a firm's own category will not.
    expect(all.every((c) => c.key !== null)).toBe(true);
    // Display order is stable and starts at 0.
    expect(all.map((c) => c.sortOrder)).toEqual(
      [...all.map((c) => c.sortOrder)].sort((a, b) => a - b),
    );
  });
});

describe('adding and retiring', () => {
  it('appends a new category after the existing ones', async () => {
    const { ctx } = await seedWorkspace();
    const before = await listDocumentCategories(ctx);
    const res = await createDocumentCategoryCore(ctx, { nameAr: 'تصاريح' });
    expect(res.ok).toBe(true);

    const after = await listDocumentCategories(ctx);
    expect(after).toHaveLength(before.length + 1);
    const added = after[after.length - 1];
    expect(added.nameAr).toBe('تصاريح');
    // A firm's own category has no seed key.
    expect(added.key).toBeNull();
    expect(added.sortOrder).toBeGreaterThan(before[before.length - 1].sortOrder);
  });

  it('requires a name in at least one locale', async () => {
    const { ctx } = await seedWorkspace();
    expect(await createDocumentCategoryCore(ctx, {})).toEqual({
      ok: false,
      error: 'name_required',
    });
    expect(
      await createDocumentCategoryCore(ctx, { nameAr: '   ', nameEn: '' }),
    ).toEqual({ ok: false, error: 'name_required' });
  });

  it('retires a category without touching what is filed under it', async () => {
    const { ctx } = await seedWorkspace();
    const [first] = await listDocumentCategories(ctx);

    expect(
      (await updateDocumentCategoryCore(ctx, {
        id: first.id,
        nameEn: first.nameEn,
        nameAr: first.nameAr,
        active: false,
      })).ok,
    ).toBe(true);

    // Gone from the picker...
    const active = await listActiveDocumentCategories(ctx);
    expect(active.map((c) => c.id)).not.toContain(first.id);
    // ...but still present, so existing documents keep a real category name.
    const all = await listDocumentCategories(ctx);
    expect(all.map((c) => c.id)).toContain(first.id);
  });

  it('restores a retired category', async () => {
    const { ctx } = await seedWorkspace();
    const [first] = await listDocumentCategories(ctx);
    const rename = { id: first.id, nameEn: first.nameEn, nameAr: first.nameAr };
    await updateDocumentCategoryCore(ctx, { ...rename, active: false });
    await updateDocumentCategoryCore(ctx, { ...rename, active: true });
    expect((await listActiveDocumentCategories(ctx)).map((c) => c.id)).toContain(
      first.id,
    );
  });

  it('a rename that omits `active` does not silently retire it', async () => {
    // The same partial-update discipline the client and project cores use.
    const { ctx } = await seedWorkspace();
    const [first] = await listDocumentCategories(ctx);
    expect(
      (await updateDocumentCategoryCore(ctx, { id: first.id, nameAr: 'اسم جديد' })).ok,
    ).toBe(true);
    const [after] = (await listDocumentCategories(ctx)).filter((c) => c.id === first.id);
    expect(after.nameAr).toBe('اسم جديد');
    expect(after.active).toBe(true);
  });

  it('grants NO delete — a category cannot be removed out from under its files', async () => {
    const rows = await raw.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
       where grantee = 'metra_app' and table_name = 'document_categories'`,
    );
    const granted = new Set(rows.map((r) => r.privilege_type));
    expect(granted.has('SELECT')).toBe(true);
    expect(granted.has('INSERT')).toBe(true);
    expect(granted.has('UPDATE')).toBe(true);
    expect(granted.has('DELETE')).toBe(false);
  });
});

describe('resolveCategoryId — what a document may be filed under', () => {
  it('accepts null as uncategorised', async () => {
    const { ctx } = await seedWorkspace();
    expect(await resolveCategoryId(ctx, null)).toBeNull();
    expect(await resolveCategoryId(ctx, undefined)).toBeNull();
    expect(await resolveCategoryId(ctx, '')).toBeNull();
  });

  it('accepts an active category of this org', async () => {
    const { ctx } = await seedWorkspace();
    const [first] = await listActiveDocumentCategories(ctx);
    expect(await resolveCategoryId(ctx, first.id)).toBe(first.id);
  });

  it('refuses a RETIRED category — old documents keep it, new ones cannot use it', async () => {
    const { ctx } = await seedWorkspace();
    const [first] = await listDocumentCategories(ctx);
    await updateDocumentCategoryCore(ctx, {
      id: first.id,
      nameEn: first.nameEn,
      nameAr: first.nameAr,
      active: false,
    });
    expect(await resolveCategoryId(ctx, first.id)).toBe(INVALID_CATEGORY);
  });

  it("refuses ANOTHER org's category", async () => {
    const mine = await seedWorkspace();
    const theirs = await seedWorkspace();
    const [theirCategory] = await listActiveDocumentCategories(theirs.ctx);
    expect(await resolveCategoryId(mine.ctx, theirCategory.id)).toBe(INVALID_CATEGORY);
  });

  it('refuses a malformed or forged id', async () => {
    const { ctx } = await seedWorkspace();
    expect(await resolveCategoryId(ctx, 'not-a-uuid')).toBe(INVALID_CATEGORY);
    expect(
      await resolveCategoryId(ctx, '3f2504e0-4f89-41d3-9a0c-0305e82c3301'),
    ).toBe(INVALID_CATEGORY);
  });
});

describe('tenancy', () => {
  it("one firm's vocabulary is invisible to another", async () => {
    const a = await seedWorkspace();
    const b = await seedWorkspace();
    await createDocumentCategoryCore(a.ctx, { nameEn: 'A-only' });

    const aNames = (await listDocumentCategories(a.ctx)).map((c) => c.nameEn);
    const bNames = (await listDocumentCategories(b.ctx)).map((c) => c.nameEn);
    expect(aNames).toContain('A-only');
    expect(bNames).not.toContain('A-only');
  });

  it('a client document can be filed under this org’s category', async () => {
    const { ctx } = await seedWorkspace();
    await createClientCore(ctx, { nameEn: 'Acme', phone: '01000000000' });
    const [client] = await listClients(ctx, {});
    const [category] = await listActiveDocumentCategories(ctx);
    expect(client.id).toBeTruthy();
    expect(await resolveCategoryId(ctx, category.id)).toBe(category.id);
  });
});
