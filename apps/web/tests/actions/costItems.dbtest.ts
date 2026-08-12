import { afterAll, describe, expect, it } from 'vitest';
import {
  createCostItemCore,
  setCostItemActiveCore,
  updateCostItemCore,
} from '@/lib/price-book/core';
import { listCostItems } from '@/lib/price-book/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const base = {
  nameEn: 'Wall paint',
  nameAr: 'دهان حائط',
  unit: 'sqm' as const,
  defaultUnitCost: '45',
  defaultUnitPrice: '70',
};

describe('createCostItemCore', () => {
  it('creates a cost item + audit', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const sectionId = await raw.sectionId(orgId);

    const res = await createCostItemCore(ctx, { code: 'PB-1', sectionId, ...base });
    expect(res.ok).toBe(true);
    expect(await raw.count('cost_items', orgId)).toBe(1);
    expect(await raw.count('audit_log', orgId)).toBe(1);
  });

  it('rejects a duplicate code with code_taken', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const sectionId = await raw.sectionId(orgId);
    await createCostItemCore(ctx, { code: 'DUP', sectionId, ...base });
    const res = await createCostItemCore(ctx, { code: 'DUP', sectionId, ...base });
    expect(res).toEqual({ ok: false, error: 'code_taken' });
    expect(await raw.count('cost_items', orgId)).toBe(1);
  });

  it('rejects an empty code / empty name', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const sectionId = await raw.sectionId(orgId);
    expect(
      await createCostItemCore(ctx, { code: '  ', sectionId, ...base }),
    ).toEqual({
      ok: false,
      error: 'code_required',
    });
    expect(
      await createCostItemCore(ctx, {
        code: 'X',
        sectionId,
        ...base,
        nameEn: '',
        nameAr: '',
      }),
    ).toEqual({ ok: false, error: 'name_required' });
  });

  it('rejects a section from another org (invalid)', async () => {
    const a = await seedOrg({ owners: 1 });
    const b = await seedOrg({ owners: 1 });
    orgIds.push(a.orgId, b.orgId);
    const ctxA = ctxFor(a.orgId, a.ownerIds[0], 'owner');
    const foreignSection = await raw.sectionId(b.orgId);
    const res = await createCostItemCore(ctxA, {
      code: 'XORG',
      sectionId: foreignSection,
      ...base,
    });
    expect(res).toEqual({ ok: false, error: 'invalid' });
    expect(await raw.count('cost_items', a.orgId)).toBe(0);
  });

  it('forbids a viewer, a PM and an accountant from creating', async () => {
    const { orgId, memberIds } = await seedOrg({
      owners: 1,
      members: [
        { role: 'viewer' },
        { role: 'project_manager' },
        { role: 'accountant' },
      ],
    });
    orgIds.push(orgId);
    const sectionId = await raw.sectionId(orgId);
    for (const uid of memberIds) {
      const role = (await raw.memberships(orgId)).find(
        (m) => m.user_id === uid,
      )!.role;
      const res = await createCostItemCore(
        ctxFor(orgId, uid, role as never),
        { code: `C-${uid.slice(0, 4)}`, sectionId, ...base },
      );
      expect(res).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(await raw.count('cost_items', orgId)).toBe(0);
  });
});

describe('update + activate', () => {
  it('updates fields and toggles active', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const ctx = ctxFor(orgId, ownerIds[0], 'owner');
    const sectionId = await raw.sectionId(orgId);
    await createCostItemCore(ctx, { code: 'UP-1', sectionId, ...base });
    const [item] = await listCostItems(ctx, {});

    const upd = await updateCostItemCore(ctx, {
      id: item.id,
      code: 'UP-1',
      sectionId,
      ...base,
      defaultUnitPrice: '99',
    });
    expect(upd.ok).toBe(true);

    const act = await setCostItemActiveCore(ctx, { id: item.id, active: false });
    expect(act.ok).toBe(true);

    const [after] = await listCostItems(ctx, {});
    expect(after.defaultUnitPrice).toBe('99.0000');
    expect(after.active).toBe(false);
  });
});
