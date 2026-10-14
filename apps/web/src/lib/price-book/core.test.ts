import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { createCostItemCore, updateCostItemCore } from './core';
import type { CostItemInput } from './fields';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/context', () => ({ withOrgContext: vi.fn() }));

// The race the read checks cannot see (AC 26): two saves of the same code both
// pass the duplicate read, and the loser's 23505 on the org/code unique index
// must land under Code exactly as the read-check refusal does.

const ctx = { orgId: 'o1', userId: 'u1', role: 'owner' } as unknown as OrgContext;
const openTransaction = vi.mocked(withOrgContext);
const INPUT: CostItemInput = {
  code: 'PB-1',
  nameEn: 'Board',
  sectionId: '00000000-0000-4000-8000-000000000001',
  unit: 'sqm',
  defaultUnitCost: '10',
  defaultUnitPrice: '12',
};

beforeEach(() => openTransaction.mockReset());

describe('a cost-item save that loses a race', () => {
  it.each([
    ['create', () => createCostItemCore(ctx, INPUT)],
    ['update', () => updateCostItemCore(ctx, { id: INPUT.sectionId, ...INPUT })],
  ])('on %s, a 23505 on the code index is code_taken under Code', async (_name, save) => {
    openTransaction.mockRejectedValueOnce({
      code: '23505',
      constraint_name: 'cost_items_org_id_code_unique',
    });
    await expect(save()).resolves.toEqual({
      ok: false,
      error: 'check_fields',
      fields: { code: { code: 'code_taken' } },
    });
  });

  it('a category deleted between the read and the insert is under Category', async () => {
    openTransaction.mockRejectedValueOnce({
      code: '23503',
      constraint_name: 'cost_items_section_same_org_fk',
    });
    await expect(createCostItemCore(ctx, INPUT)).resolves.toEqual({
      ok: false,
      error: 'check_fields',
      fields: { sectionId: { code: 'no_longer_exists' } },
    });
  });

  it('typed-value refusals come back before any transaction opens', async () => {
    await expect(createCostItemCore(ctx, { ...INPUT, code: ' ', defaultUnitCost: 'x' })).resolves.toEqual({
      ok: false,
      error: 'check_fields',
      fields: { code: { code: 'code_required' }, defaultUnitCost: { code: 'not_a_number' } },
    });
    expect(openTransaction).not.toHaveBeenCalled();
  });
});
