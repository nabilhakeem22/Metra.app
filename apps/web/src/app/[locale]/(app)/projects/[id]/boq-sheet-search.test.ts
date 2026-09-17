import { describe, expect, test } from 'vitest';
import type { BoqDetail, BoqLineRow, BoqSectionRow } from '@/lib/boqs/queries';
import {
  countVisibleLines,
  matchesNeedle,
  searchNeedle,
  visibleLines,
} from './boq-sheet-search';

function line(overrides: Partial<BoqLineRow> = {}): BoqLineRow {
  return {
    id: 'line-1',
    itemCode: '2.03.1',
    description: 'Gypsum ceiling',
    unit: 'sqm',
    qty: '4.0000',
    unitPrice: '2500.0000',
    discountPct: '0.0000',
    lineTotal: '10000.0000',
    provisional: false,
    ...overrides,
  };
}

function section(lines: BoqLineRow[], id = 'section-1'): BoqSectionRow {
  return { id, title: 'Ceilings', sectionSubtotal: '0.0000', lines };
}

function boq(sections: BoqSectionRow[]): BoqDetail {
  return {
    id: 'boq-1',
    number: 1,
    title: 'BOQ',
    status: 'draft',
    source: 'manual',
    currency: 'EGP',
    discountPct: '0.0000',
    subtotal: '0.0000',
    discountAmount: '0.0000',
    total: '0.0000',
    lineCount: 0,
    sections,
  };
}

describe('searchNeedle', () => {
  test('trims and lower-cases, so the caller never has to', () => {
    expect(searchNeedle('  Gypsum  ')).toBe('gypsum');
  });

  test('a whitespace-only query is the empty needle', () => {
    expect(searchNeedle('   ')).toBe('');
  });
});

describe('matchesNeedle', () => {
  test('an empty needle matches every line', () => {
    expect(matchesNeedle(line(), '')).toBe(true);
  });

  test('matches on the DESCRIPTION, case-insensitively', () => {
    expect(matchesNeedle(line(), 'ceiling')).toBe(true);
  });

  test('matches on the ITEM CODE — the two columns are searched as one string', () => {
    expect(matchesNeedle(line(), '2.03')).toBe(true);
  });

  test('a null item code does not match the word null', () => {
    expect(matchesNeedle(line({ itemCode: null }), 'null')).toBe(false);
  });

  test('a line matching neither column is out', () => {
    expect(matchesNeedle(line(), 'marble')).toBe(false);
  });

  test('Arabic is matched as typed — no normalisation is claimed here', () => {
    expect(matchesNeedle(line({ description: 'سقف جبسوم' }), 'جبسوم')).toBe(true);
  });
});

describe('visibleLines', () => {
  test('each surviving line remembers the section it came from', () => {
    const result = visibleLines(section([line()]), 'gypsum');
    expect(result).toHaveLength(1);
    expect(result[0]?.sectionId).toBe('section-1');
  });

  test('filters the section down to the matches', () => {
    const rows = [line(), line({ id: 'line-2', description: 'Marble floor', itemCode: null })];
    expect(visibleLines(section(rows), 'marble').map((row) => row.id)).toEqual(['line-2']);
  });
});

describe('countVisibleLines', () => {
  test('counts ACROSS sections, not within one', () => {
    const document = boq([
      section([line(), line({ id: 'line-2', description: 'Marble floor' })]),
      section([line({ id: 'line-3', description: 'Gypsum bulkhead' })], 'section-2'),
    ]);
    expect(countVisibleLines(document, 'gypsum')).toBe(2);
    expect(countVisibleLines(document, '')).toBe(3);
  });

  test('a search that matches nothing counts zero, not the total', () => {
    expect(countVisibleLines(boq([section([line()])]), 'granite')).toBe(0);
  });
});
