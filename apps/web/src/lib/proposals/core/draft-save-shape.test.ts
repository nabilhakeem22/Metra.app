// S1: a payload that is not shaped like a draft is refused at the boundary
// (`invalid`), never a TypeError deep in the resolver.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { isSaveDraftInputShape } = await import('./draft-save-shape');

const line = { id: 'l-1', descriptionEn: 'Gypsum', qty: '1', unit: 'sqm', unitPrice: '10', sortOrder: 0 };
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'p-1',
  revision: '1789000000000000',
  header: { discountPct: '0', taxRate: '14', supervisionPct: null },
  sections: [{ titleEn: 'S', titleAr: null, sortOrder: 0, lines: [line] }],
  ...over,
});

describe('isSaveDraftInputShape', () => {
  it('accepts what the builder sends, with or without a revision', () => {
    expect(isSaveDraftInputShape(draft())).toBe(true);
    expect(isSaveDraftInputShape(draft({ revision: undefined }))).toBe(true);
    expect(isSaveDraftInputShape(draft({ sections: [] }))).toBe(true);
  });

  it.each([
    ['a line id that is an object', { sections: [{ titleEn: 'S', lines: [{ ...line, id: { toString: () => 'x' } }] }] }],
    ['a line id that is a number', { sections: [{ titleEn: 'S', lines: [{ ...line, id: 7 }] }] }],
    ['a qty that is a number', { sections: [{ titleEn: 'S', lines: [{ ...line, qty: 12 }] }] }],
    ['lines that are not a list', { sections: [{ titleEn: 'S', lines: 'x' }] }],
    ['a section that is null', { sections: [null] }],
    ['sections that are not a list', { sections: {} }],
    ['a revision that is not a token', { revision: 'yesterday' }],
    ['a header field that is an object', { header: { taxRate: { v: 1 } } }],
    ['a sort order that is a string', { sections: [{ titleEn: 'S', lines: [{ ...line, sortOrder: '1' }] }] }],
  ])('refuses %s', (_name, over) => {
    expect(isSaveDraftInputShape(draft(over))).toBe(false);
  });

  it('refuses a payload that is not an object or has no id', () => {
    expect(isSaveDraftInputShape(null)).toBe(false);
    expect(isSaveDraftInputShape([])).toBe(false);
    expect(isSaveDraftInputShape({ sections: [] })).toBe(false);
  });
});
