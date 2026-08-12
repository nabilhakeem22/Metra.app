import { afterAll, describe, expect, it } from 'vitest';
import { upsertSectionLibraryEntryCore } from '@/lib/section-library/core';
import { listSectionLibrary } from '@/lib/section-library/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('upsertSectionLibraryEntryCore (create-on-use, idempotent)', () => {
  it('creates one row and returns its id', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');

    const res = await upsertSectionLibraryEntryCore(ctx, {
      nameEn: 'Civil works',
    });
    expect(res.ok).toBe(true);
    expect(res.data).toBeTruthy();
    expect(await raw.count('proposal_section_library', orgId)).toBe(1);
  });

  it('is idempotent: the same trimmed name (any case) returns the same id, no new row', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');

    const first = await upsertSectionLibraryEntryCore(ctx, { nameEn: 'MEP' });
    const again = await upsertSectionLibraryEntryCore(ctx, { nameEn: '  mep ' });
    expect(first.ok && again.ok).toBe(true);
    expect(again.data).toBe(first.data);
    expect(await raw.count('proposal_section_library', orgId)).toBe(1);
  });

  it('matches on either language independently', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');

    const en = await upsertSectionLibraryEntryCore(ctx, { nameEn: 'Finishes' });
    // Same English name, different Arabic supplied -> still the same row.
    const mixed = await upsertSectionLibraryEntryCore(ctx, {
      nameEn: 'Finishes',
      nameAr: 'تشطيبات',
    });
    expect(mixed.data).toBe(en.data);
    expect(await raw.count('proposal_section_library', orgId)).toBe(1);
  });

  it('rejects when both names are blank', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    expect(
      await upsertSectionLibraryEntryCore(ctx, { nameEn: '  ', nameAr: '' }),
    ).toEqual({ ok: false, error: 'name_required' });
  });

  it('forbids a viewer', async () => {
    const { orgId, memberIds } = await seedOrg({
      owners: 1,
      members: [{ role: 'viewer' }],
    });
    orgIds.push(orgId);
    const res = await upsertSectionLibraryEntryCore(
      ctxFor(orgId, memberIds[0], 'viewer'),
      { nameEn: 'Nope' },
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });

  it('listSectionLibrary returns active org rows', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    await upsertSectionLibraryEntryCore(ctx, { nameEn: 'Alpha' });
    await upsertSectionLibraryEntryCore(ctx, { nameEn: 'Beta' });
    const rows = await listSectionLibrary(ctx);
    expect(rows.map((r) => r.nameEn)).toEqual(['Alpha', 'Beta']);
  });
});
