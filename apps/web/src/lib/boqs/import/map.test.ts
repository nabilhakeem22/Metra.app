import { describe, expect, it } from 'vitest';
import { decodeCsv, parseCsv, sniffDelimiter } from './decode';
import {
  autoDetectMapping,
  mapRows,
  normalizeUnit,
  parseNumericCell,
  toWesternDigits,
  DEFAULT_SECTION,
} from './map';

describe('sniffDelimiter', () => {
  it('reads a semicolon sheet, which is what Egyptian Excel writes', () => {
    // Guessing comma here yields one giant column — the failure that looks like
    // a broken importer rather than a locale difference.
    expect(sniffDelimiter('Item;Description;Unit;Qty')).toBe(';');
  });

  it('defaults to comma', () => {
    expect(sniffDelimiter('Item,Description,Unit,Qty')).toBe(',');
  });

  it('ignores separators inside quoted fields', () => {
    // One real comma; the semicolons are inside a quoted description.
    expect(sniffDelimiter('"Walls; ceilings; soffits",Qty')).toBe(',');
  });

  it('reads tabs', () => {
    expect(sniffDelimiter('Item\tDescription\tQty')).toBe('\t');
  });
});

describe('parseCsv', () => {
  it('handles quotes, embedded delimiters and doubled quotes', () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\n1,2,3', ',');
    expect(rows[0]).toEqual(['a', 'b,c', 'say "hi"']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });

  it('keeps a final row that has no trailing newline', () => {
    expect(parseCsv('a,b\nc,d', ',')).toHaveLength(2);
  });

  it('strips the UTF-8 BOM Excel writes', () => {
    // Left in place it becomes part of the first header and every mapping misses.
    const rows = parseCsv('﻿Description,Qty\nWalls,10', ',');
    expect(rows[0]?.[0]).toBe('Description');
  });

  it('survives CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d\r\n', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('decodeCsv', () => {
  it('drops the blank rows Excel leaves behind', () => {
    const { grid } = decodeCsv('Description,Qty\nWalls,10\n,\n\n');
    expect(grid.rows).toHaveLength(2);
  });

  it('says so when it had to guess a non-comma delimiter', () => {
    expect(decodeCsv('a;b\n1;2').notes).toContain('Read as semicolon-separated.');
  });
});

describe('toWesternDigits', () => {
  it('converts Arabic-Indic digits', () => {
    // A studio on an Arabic keyboard types ١٢٠; Number('١٢٠') is NaN, so without
    // this a perfectly valid sheet imports as a page of errors.
    expect(toWesternDigits('١٢٠')).toBe('120');
  });

  it('converts Eastern-Arabic (Persian) digits', () => {
    expect(toWesternDigits('۱۲۰')).toBe('120');
  });
});

describe('parseNumericCell', () => {
  it('accepts what people actually type', () => {
    expect(parseNumericCell('1,200.50')).toBe('1200.50');
    expect(parseNumericCell('  12 ')).toBe('12');
    expect(parseNumericCell('١٢٫٥')).toBe('12.5');
  });

  it('rejects text and empties', () => {
    expect(parseNumericCell('n/a')).toBeNull();
    expect(parseNumericCell('')).toBeNull();
    expect(parseNumericCell('12 m2')).toBeNull();
  });
});

describe('normalizeUnit', () => {
  it('maps the variants a BOQ actually contains onto Metra units', () => {
    for (const raw of ['m2', 'M²', 'sqm', 'sq.m', 'متر مربع']) {
      expect(normalizeUnit(raw)).toBe('sqm');
    }
    expect(normalizeUnit('L.M')).toBe('linear_meter');
    expect(normalizeUnit('متر طولي')).toBe('linear_meter');
    expect(normalizeUnit('nos')).toBe('pcs');
    expect(normalizeUnit('عدد')).toBe('pcs');
    expect(normalizeUnit('Lump Sum')).toBe('lump_sum');
    expect(normalizeUnit('يوم')).toBe('day');
  });

  it('returns null for a unit Metra does not have', () => {
    // Better a named error in the preview than a silent coercion to sqm.
    expect(normalizeUnit('tonne')).toBeNull();
    expect(normalizeUnit('')).toBeNull();
  });
});

describe('autoDetectMapping', () => {
  it('matches English and Arabic headers', () => {
    const m = autoDetectMapping(['Item', 'الوصف', 'Unit', 'Qty', 'Rate']);
    expect(m.itemCode).toBe(0);
    expect(m.description).toBe(1);
    expect(m.unit).toBe(2);
    expect(m.qty).toBe(3);
    expect(m.unitPrice).toBe(4);
  });

  it('is insensitive to case, spacing and punctuation', () => {
    const m = autoDetectMapping(['  UNIT_PRICE ', 'Description']);
    expect(m.unitPrice).toBe(0);
    expect(m.description).toBe(1);
  });

  it('leaves an absent field unmapped rather than guessing', () => {
    expect(autoDetectMapping(['Description', 'Qty']).unitPrice).toBe(-1);
  });

  it('never assigns one column to two fields', () => {
    // 'cost' matches unitCost; it must not also be taken as unitPrice.
    const m = autoDetectMapping(['Description', 'Unit', 'Qty', 'Price', 'Cost']);
    const used = [m.unitPrice, m.unitCost].filter((i) => i >= 0);
    expect(new Set(used).size).toBe(used.length);
  });
});

const grid = (csv: string) => decodeCsv(csv).grid;

describe('mapRows', () => {
  const sheet = [
    'Item,Section,Description,Unit,Qty,Rate,Cost',
    '2.01,Gypsum works,Ceiling,m2,100,1500,900',
    '2.02,Gypsum works,Cornice,L.M,45,220,140',
  ].join('\n');

  it('maps a clean sheet to lines', () => {
    const g = grid(sheet);
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.errorCount).toBe(0);
    expect(res.ok).toHaveLength(2);
    expect(res.ok[0]).toMatchObject({
      itemCode: '2.01',
      section: 'Gypsum works',
      description: 'Ceiling',
      unit: 'sqm',
      qty: '100',
      unitPrice: '1500',
      unitCost: '900',
      provisional: false,
    });
    expect(res.ok[1]?.unit).toBe('linear_meter');
  });

  it('numbers errors by the row the studio sees in Excel', () => {
    // Header is row 1, so the first data row is row 2.
    const g = grid('Description,Unit,Qty,Rate\nWalls,tonne,10,50');
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.rows[0]?.rowNumber).toBe(2);
    expect(res.rows[0]?.errors[0]).toContain('tonne');
  });

  it('reports every bad row instead of stopping at the first', () => {
    const g = grid(
      [
        'Description,Unit,Qty,Rate',
        'Walls,tonne,10,50',
        'Ceiling,m2,abc,50',
        'Floor,m2,10,50',
      ].join('\n'),
    );
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.errorCount).toBe(2);
    expect(res.ok).toHaveLength(1);
    expect(res.ok[0]?.description).toBe('Floor');
  });

  it('rejects a negative quantity — a de-scope is a variation, never a BOQ line', () => {
    const g = grid('Description,Unit,Qty,Rate\nWalls,m2,-5,50');
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.rows[0]?.errors).toContain('Quantity cannot be negative');
  });

  it('treats a missing cost as zero, not as an error', () => {
    // A line with no cost basis is blind on margin — a real state, not a fault.
    const g = grid('Description,Unit,Qty,Rate,Cost\nWalls,m2,10,50,');
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.errorCount).toBe(0);
    expect(res.ok[0]?.unitCost).toBe('0');
  });

  it('falls back to one default section when the sheet has no section column', () => {
    const g = grid('Description,Unit,Qty,Rate\nWalls,m2,10,50');
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.ok[0]?.section).toBe(DEFAULT_SECTION);
  });

  it('reads the provisional flag in either language', () => {
    const g = grid(
      'Description,Unit,Qty,Rate,Provisional\nDemolition,m2,200,80,yes\nDoors,pcs,8,3000,\nChasing,lm,30,40,نعم',
    );
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.ok.map((l) => l.provisional)).toEqual([true, false, true]);
  });

  it('fails every row, with one clear reason, when a required column is unmapped', () => {
    const g = grid('Description,Unit,Qty\nWalls,m2,10');
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.ok).toHaveLength(0);
    expect(res.rows[0]?.errors[0]).toContain('unitPrice');
  });

  it('imports an Arabic sheet end to end', () => {
    const g = grid(
      ['البند,الوصف,الوحدة,الكمية,سعر الوحدة', '٢٫٠١,دهانات,متر مربع,١٢٠,٨٥'].join('\n'),
    );
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.errorCount).toBe(0);
    expect(res.ok[0]).toMatchObject({
      description: 'دهانات',
      unit: 'sqm',
      qty: '120',
      unitPrice: '85',
    });
  });
});
