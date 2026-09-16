import { describe, expect, it } from 'vitest';
import { decodeCsv, parseCsvRows, sniffDelimiter, stripBom } from './decode';
import { ImportParseError, MAX_RAW_ROWS } from '@/lib/import/limits';
import { readMoneyString } from '@/lib/money/read';
import {
  autoDetectMapping,
  mapRows,
  normalizeUnit,
  DEFAULT_SECTION,
} from './map';
import { buildTemplateCsv } from './template';

// The EXACT option set boqs/import/map.ts uses for a cell in an imported sheet —
// the one money surface that reads Arabic-Indic digits.
const readImportedCell = (raw: string) =>
  readMoneyString(raw, {
    allowNegative: true,
    allowGroupSeparators: true,
    allowArabicDigits: true,
  });

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

describe('parseCsvRows', () => {
  const parseCsv = (text: string, delimiter: string) =>
    parseCsvRows(text, { delimiter });

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
    // The strip moved OUT of the parser and into the decoder, where both
    // pipelines get it; the parser itself is now only a parser.
    const rows = parseCsv(stripBom('﻿Description,Qty\nWalls,10'), ',');
    expect(rows[0]?.[0]).toBe('Description');
    expect(decodeCsv('﻿Description,Qty\nWalls,10').grid.rows[0]?.[0]).toBe('Description');
  });

  it('survives CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d\r\n', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  // THE BUG THE SHARED PARSER FIXES FOR THIS PIPELINE. The BOQ's own parser
  // opened quote mode on ANY `"`, so an inch mark — and a fit-out BOQ is full of
  // them — swallowed the rest of the file into one field and every row after it
  // vanished from the import with no error at all.
  it('keeps a mid-field quote literal instead of swallowing the rest of the file', () => {
    expect(parseCsv('code,name,qty\nA-1,3" pipe,120\nA-2,Door,5\n', ',')).toEqual([
      ['code', 'name', 'qty'],
      ['A-1', '3" pipe', '120'],
      ['A-2', 'Door', '5'],
    ]);
  });

  it('bails with too_many_rows before building a runaway matrix', () => {
    // A 5 MB file of bare newlines must not materialise millions of tiny arrays
    // on its way to the fine row check.
    expect(() => parseCsvRows('a\n'.repeat(MAX_RAW_ROWS + 10), { delimiter: ',' })).toThrow(
      ImportParseError,
    );
    expect(() =>
      parseCsvRows('a\n'.repeat(5), { delimiter: ',', maxRows: 3 }),
    ).toThrow(expect.objectContaining({ reason: 'too_many_rows' }));
  });
});

describe('decodeCsv', () => {
  it('drops the blank rows Excel leaves behind', () => {
    const { grid } = decodeCsv('Description,Qty\nWalls,10\n,\n\n');
    expect(grid.rows).toHaveLength(2);
  });

  it('says so when it had to guess a non-comma delimiter', () => {
    // A CODE, not an English sentence: this note renders in an Arabic-first UI.
    expect(decodeCsv('a;b\n1;2').notes).toEqual(['semicolon_separated']);
    expect(decodeCsv('a\tb\n1\t2').notes).toEqual(['tab_separated']);
    expect(decodeCsv('a,b\n1,2').notes).toEqual([]);
  });
});

describe('an imported numeric cell', () => {
  it('accepts what people actually type', () => {
    expect(readImportedCell('1,200.50')).toBe('1200.50');
    expect(readImportedCell('  12 ')).toBe('12');
    expect(readImportedCell('١٢٫٥')).toBe('12.5');
  });

  it('reads Arabic-Indic and Persian digits', () => {
    // A studio on an Arabic keyboard types ١٢٠; Number('١٢٠') is NaN, so without
    // this a perfectly valid sheet imports as a page of errors.
    expect(readImportedCell('١٢٠')).toBe('120');
    expect(readImportedCell('۱۲۰')).toBe('120');
  });

  it('rejects text and empties', () => {
    expect(readImportedCell('n/a')).toBeNull();
    expect(readImportedCell('')).toBeNull();
    expect(readImportedCell('12 m2')).toBeNull();
  });

  it('REFUSES an ambiguous comma this cell used to read as grouping', () => {
    // BEHAVIOUR CHANGE (wave 2): '1,5' became 15 in an imported price. The row
    // now fails with the unreadable-cell code, which the studio sees in the problem
    // list instead of importing a ten-fold error silently.
    for (const ambiguous of ['1,5', '1,2,3', '1.234,56']) {
      expect(readImportedCell(ambiguous)).toBeNull();
    }
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

  it('numbers rows as Excel does, and carries the offending cell as a VALUE', () => {
    // Header is row 1, so the first data row is row 2. The cell travels as
    // `value` rather than baked into an English sentence, so the ar-EG catalogue
    // can interpolate it.
    const g = grid('Description,Unit,Qty,Rate\nWalls,tonne,10,50');
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.rows[0]?.rowNumber).toBe(2);
    expect(res.rows[0]?.issues[0]).toEqual({ code: 'unit_unknown', value: 'tonne' });
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
    expect(res.rows[0]?.issues).toContainEqual({ code: 'qty_negative' });
  });

  it('tells a too-large cell apart from an unreadable one', () => {
    // Two different problems with two different fixes: a stray unit in the cell
    // versus a figure past the 1e12 cap that reads perfectly well. "Quantity is
    // not a number" for 1e13 is wrong, and the studio can see that it is wrong.
    const tooLarge = grid('Description,Unit,Qty,Rate\nWalls,m2,10000000000000,50');
    const first = mapRows(tooLarge, autoDetectMapping(tooLarge.rows[0] as string[]));
    expect(first.rows[0]?.issues).toContainEqual({ code: 'qty_too_large' });

    const nonsense = grid('Description,Unit,Qty,Rate\nWalls,m2,n/a,50');
    const second = mapRows(nonsense, autoDetectMapping(nonsense.rows[0] as string[]));
    expect(second.rows[0]?.issues).toContainEqual({ code: 'qty_not_a_number' });

    const dearRate = grid('Description,Unit,Qty,Rate\nWalls,m2,10,99999999999999');
    const third = mapRows(dearRate, autoDetectMapping(dearRate.rows[0] as string[]));
    expect(third.rows[0]?.issues).toContainEqual({ code: 'unit_price_too_large' });
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
    // The COLUMN as the sheet spells it, not the field identifier: a studio
    // cannot find "unitPrice" across the top of their own spreadsheet.
    expect(res.rows[0]?.issues[0]).toEqual({
      code: 'unmapped_columns',
      value: 'Unit price',
    });
  });

  it('names every missing column, in template order', () => {
    const g = grid('Item,Section\nA,B');
    const res = mapRows(g, autoDetectMapping(g.rows[0] as string[]));
    expect(res.rows[0]?.issues[0]).toEqual({
      code: 'unmapped_columns',
      value: 'Description, Unit, Qty, Unit price',
    });
  });

  it('names columns with the exact text the downloaded template writes', () => {
    // One table serves both, so a studio who used our template and deleted a
    // column is told the name that was standing in it.
    const [headerLine] = stripBom(buildTemplateCsv()).split('\n');
    const header = headerLine?.split(',');
    for (const label of ['Description', 'Unit', 'Qty', 'Unit price']) {
      expect(header).toContain(label);
    }
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
