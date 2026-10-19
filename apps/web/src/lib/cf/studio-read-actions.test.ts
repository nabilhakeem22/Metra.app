import { beforeEach, describe, expect, it, vi } from 'vitest';

// The two picker searches on the member's studio read budget: past it they
// answer `rate_limited` (the pickers show errors.rate_limited) and read nothing.

const deps = vi.hoisted(() => ({
  requireOrg: vi.fn(),
  studioReadRefusal: vi.fn(),
  searchPriceBookPickerCore: vi.fn(),
  searchBaselineLinesCore: vi.fn(),
  loadSectionLinesCore: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: deps.requireOrg }));
vi.mock('@/lib/cf/studio-read-rate-limit', () => ({ studioReadRefusal: deps.studioReadRefusal }));
vi.mock('@/lib/price-book/picker-core', () => ({ searchPriceBookPickerCore: deps.searchPriceBookPickerCore }));
vi.mock('@/lib/contracts/lines-core', () => ({
  searchBaselineLinesCore: deps.searchBaselineLinesCore,
  loadSectionLinesCore: deps.loadSectionLinesCore,
}));

const { searchPriceBookPicker } = await import('@/lib/price-book/picker-actions');
const { searchBaselineLines } = await import('@/lib/contracts/lines-actions');

const CTX = { orgId: 'org-1', userId: 'user-1', role: 'owner' };
const REQUEST = { contractId: 'c-1', query: 'tile', afterLineId: null };

beforeEach(() => {
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.requireOrg.mockResolvedValue(CTX);
  deps.studioReadRefusal.mockResolvedValue(null);
  deps.searchPriceBookPickerCore.mockResolvedValue({ ok: true, data: { items: [] } });
  deps.searchBaselineLinesCore.mockResolvedValue({ ok: true, data: { lines: [] } });
});

describe('studio read budget on the picker searches', () => {
  it('searches as before while the budget allows, each on its own surface', async () => {
    expect(await searchPriceBookPicker('tile', 'en')).toEqual({ ok: true, data: { items: [] } });
    expect(await searchBaselineLines(REQUEST as never)).toEqual({ ok: true, data: { lines: [] } });
    expect(deps.studioReadRefusal.mock.calls).toEqual([[CTX, 'price_book_picker'], [CTX, 'contract_line_search']]);
  });

  it('answers the refusal and reads nothing past the budget', async () => {
    deps.studioReadRefusal.mockResolvedValue({ ok: false, error: 'rate_limited' });
    expect(await searchPriceBookPicker('tile', 'en')).toEqual({ ok: false, error: 'rate_limited' });
    expect(await searchBaselineLines(REQUEST as never)).toEqual({ ok: false, error: 'rate_limited' });
    expect(deps.searchPriceBookPickerCore).not.toHaveBeenCalled();
    expect(deps.searchBaselineLinesCore).not.toHaveBeenCalled();
  });
});
