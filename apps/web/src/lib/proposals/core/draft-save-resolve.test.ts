// F1 across repeated saves: a stored line keeps its id through the rebuild, so a
// builder that saves again without reloading (autosave) still names lines the
// server knows, and their stored cost survives a margin-blind save.
import { describe, expect, it, vi } from 'vitest';

// The module re-exports the price-book loader, which is server-only.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/actions/mutate', () => ({
  fail: (code: string) => {
    throw new Error(code);
  },
}));

const { resolveDraftLines } = await import('./draft-save-resolve');

const line = (id: string | null, descriptionEn: string) => ({
  id,
  descriptionEn,
  qty: '2',
  unit: 'sqm' as const,
  unitCost: null,
  unitPrice: '800',
  discountPct: '0',
});

describe('resolveDraftLines keeps stored ids', () => {
  it('a stored id is kept with its cost; a repeat and an unknown id become new lines', () => {
    const snapshot = new Map([['l-1', '500.0000']]);
    const { resolvedSections } = resolveDraftLines(
      [{ titleEn: 'S', lines: [line('l-1', 'A'), line('l-1', 'A again'), line('l-9', 'B'), line(null, 'C')] }],
      new Map(),
      snapshot,
      false,
    );
    const lines = resolvedSections[0].lines;
    expect(lines.map((resolved) => resolved.id)).toEqual(['l-1', undefined, undefined, undefined]);
    expect(lines[0].unitCost).toBe('500.0000');
    expect(lines[1].unitCost).toBe('500.0000');
    expect(lines[2].unitCost).toBe('0');
  });

  it('F1: a NEW price-book line keeps the cost a margin-visible caller sent; a margin-blind one gets the price book', () => {
    const priceBook = new Map([['ci-1', { id: 'ci-1', active: true, unit: 'sqm', defaultUnitCost: '100.0000', defaultUnitPrice: '200', nameEn: 'Marble', nameAr: null }]]);
    const marble = { ...line(null, 'Marble'), costItemId: 'ci-1', unitCost: '150' };
    const owner = resolveDraftLines([{ titleEn: 'S', lines: [marble] }], priceBook as never, new Map(), true);
    const pm = resolveDraftLines([{ titleEn: 'S', lines: [marble] }], priceBook as never, new Map(), false);
    expect(owner.resolvedSections[0].lines[0].unitCost).toBe('150');
    expect(pm.resolvedSections[0].lines[0].unitCost).toBe('100.0000');
  });

  it('S1: a line id that is not a string is a new line, never a TypeError', () => {
    const odd = { ...line(null, 'A'), id: { toString: () => 'l-1' } as unknown as string };
    const { resolvedSections } = resolveDraftLines([{ titleEn: 'S', lines: [odd] }], new Map(), new Map([['l-1', '5']]), false);
    expect(resolvedSections[0].lines[0].id).toBeUndefined();
  });

  it('the first claim wins across sections', () => {
    const snapshot = new Map([['l-1', '1']]);
    const { resolvedSections } = resolveDraftLines(
      [
        { titleEn: 'S1', lines: [line('l-1', 'A')] },
        { titleEn: 'S2', lines: [line('l-1', 'A moved')] },
      ],
      new Map(),
      snapshot,
      false,
    );
    expect(resolvedSections[0].lines[0].id).toBe('l-1');
    expect(resolvedSections[1].lines[0].id).toBeUndefined();
  });
});
