import { COST_CATEGORIES } from '@metra/db';
import { describe, expect, it } from 'vitest';
import { costEntryFieldErrors, readCostEntry } from './input';
import { COST_ENTRY_CATEGORIES } from './types';

const TODAY = '2026-10-20';
const BASE = { category: 'labour', description: 'Tiling crew', amount: '2500', incurredOn: '2026-10-20' };

describe('readCostEntry', () => {
  it('reads a plain entry: trimmed text, money at scale 4, blanks as null', () => {
    expect(readCostEntry({ ...BASE, amount: '1,250.5 EGP', supplier: '  ', reference: ' R-1 ' }, TODAY)).toEqual({
      ok: true,
      values: {
        category: 'labour', description: 'Tiling crew', amount: '1250.5000', incurredOn: '2026-10-20',
        contractSectionId: null, contractLineId: null, qty: null, unit: null, unitCost: null,
        supplier: null, reference: 'R-1', costItemId: null,
      },
    });
  });

  it('takes quantity, unit and unit cost together, a zero unit cost included', () => {
    const read = readCostEntry({ ...BASE, qty: '٣', unit: 'sqm', unitCost: '0' }, TODAY);
    expect(read).toMatchObject({ ok: true, values: { qty: '3.0000', unit: 'sqm', unitCost: '0.0000' } });
  });

  it('asks for each missing part of a started quantity (AC20)', () => {
    expect(costEntryFieldErrors({ ...BASE, qty: '2', unit: 'sqm' }, TODAY)).toEqual({ unitCost: { code: 'required' } });
    expect(costEntryFieldErrors({ ...BASE, unitCost: '5' }, TODAY)).toEqual({ qty: { code: 'required' }, unit: { code: 'required' } });
    expect(costEntryFieldErrors({ ...BASE, qty: '0', unit: 'sqm', unitCost: '5' }, TODAY)).toMatchObject({ qty: { code: 'out_of_range' } });
  });

  it('refuses a zero amount as out of range, naming the smallest it keeps, never "1,5" as 15 (AC20, F4)', () => {
    const range = { code: 'out_of_range', params: { min: '0.0001', max: '1,000,000,000,000' } };
    expect(costEntryFieldErrors({ ...BASE, amount: '0' }, TODAY)).toEqual({ amount: range });
    expect(costEntryFieldErrors({ ...BASE, amount: '0.00001' }, TODAY)).toEqual({ amount: range });
    expect(readCostEntry({ ...BASE, amount: '0.0001' }, TODAY)).toMatchObject({ ok: true, values: { amount: '0.0001' } });
    expect(costEntryFieldErrors({ ...BASE, amount: '1,5' }, TODAY)).toEqual({ amount: { code: 'not_a_number' } });
    expect(costEntryFieldErrors({ ...BASE, amount: '-4' }, TODAY)).toEqual({ amount: { code: 'not_negative' } });
    expect(costEntryFieldErrors({ ...BASE, amount: '' }, TODAY)).toEqual({ amount: { code: 'required' } });
  });

  it('refuses a day that does not exist, one before 2000, or one after today in Cairo (F6)', () => {
    for (const day of ['2026-02-30', '0000-01-01', '0001-01-01', '1900-01-01', '1999-12-31']) {
      expect(costEntryFieldErrors({ ...BASE, incurredOn: day }, TODAY)).toEqual({ incurredOn: { code: 'invalid_date' } });
    }
    expect(readCostEntry({ ...BASE, incurredOn: '2000-01-01' }, TODAY)).toMatchObject({ ok: true, values: { incurredOn: '2000-01-01' } });
    expect(costEntryFieldErrors({ ...BASE, incurredOn: '2026-10-21' }, TODAY)).toEqual({ incurredOn: { code: 'date_in_future' } });
  });

  it('calls a description of invisible characters only blank (F5)', () => {
    for (const blank of ['‏', '‌', '‍', '‎', '⁠', ' ​ ﻿ ', '　']) {
      expect(costEntryFieldErrors({ ...BASE, description: blank }, TODAY)).toEqual({ description: { code: 'required' } });
    }
    expect(readCostEntry({ ...BASE, description: '‏أسمنت' }, TODAY)).toMatchObject({ ok: true, values: { description: '‏أسمنت' } });
  });

  it('asks for the section of a line, and caps the texts', () => {
    const lineId = '00000000-0000-4000-8000-000000000001';
    expect(costEntryFieldErrors({ ...BASE, contractLineId: lineId }, TODAY)).toEqual({ contractSectionId: { code: 'required' } });
    expect(costEntryFieldErrors({ ...BASE, description: 'd'.repeat(301), reference: 'r'.repeat(121) }, TODAY)).toEqual({
      description: { code: 'too_long', params: { max: 300 } },
      reference: { code: 'too_long', params: { max: 120 } },
    });
  });

  it('calls what no form can send malformed, with nothing to show under a box', () => {
    for (const forged of [
      { ...BASE, category: 'bribes' },
      { ...BASE, unit: 'furlong' },
      { ...BASE, amount: 5 },
      { ...BASE, contractSectionId: 'not-a-uuid' },
      { ...BASE, costItemId: { id: 1 } },
    ]) {
      expect(readCostEntry(forged, TODAY)).toEqual({ ok: false, malformed: true });
      expect(costEntryFieldErrors(forged, TODAY)).toEqual({});
    }
  });
});

describe('COST_ENTRY_CATEGORIES', () => {
  it('is the database enum, in its order', () => {
    expect(COST_ENTRY_CATEGORIES).toEqual(COST_CATEGORIES);
  });
});
