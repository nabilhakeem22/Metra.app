import { describe, expect, it } from 'vitest';
import { decodeCsv } from './decode';
import { autoDetectMapping, mapRows } from './map';
import { buildTemplateCsv } from './template';

// S9 (go-live security): a price-book name that starts like a formula leaves the
// template guarded (it cannot run in Excel) and comes back through the importer
// exactly as it was named.

const FORMULA_NAME = '=HYPERLINK("http://x")';
const item = (description: string) => ({ code: 'PB-1', description, unit: 'sqm', unitPrice: '10', unitCost: '4' });

/** The template with every item given a quantity, mapped as an upload is. */
function reimported(description: string) {
  const csv = buildTemplateCsv({ items: [item(description)] }).replace(',,10,4,no,PB-1', ',3,10,4,no,PB-1');
  const { grid } = decodeCsv(csv);
  return mapRows(grid, autoDetectMapping(grid.rows[0] as string[]));
}

describe('the template formula guard', () => {
  it('writes a formula-like name guarded and quoted', () => {
    expect(buildTemplateCsv({ items: [item(FORMULA_NAME)] })).toContain('"\'=HYPERLINK(""http://x"")"');
  });

  it('guards every trigger character in any cell', () => {
    const csv = buildTemplateCsv({ items: [item('@SUM(A1)'), item('+1'), item('-2+3')] });
    expect(csv).toContain(",'@SUM(A1),");
    expect(csv).toContain(",'+1,");
    expect(csv).toContain(",'-2+3,");
  });

  it('round-trips the name exactly', () => {
    const result = reimported(FORMULA_NAME);
    expect(result.errorCount).toBe(0);
    expect(result.ok[0]?.description).toBe(FORMULA_NAME);
  });

  it('keeps an apostrophe that guards nothing', () => {
    expect(reimported("'abc").ok[0]?.description).toBe("'abc");
  });

  it('reads a guarded number cell as the number', () => {
    const { grid } = decodeCsv("Description,Unit,Qty,Unit price\r\nWalls,sqm,'-2,10\r\n");
    const result = mapRows(grid, autoDetectMapping(grid.rows[0] as string[]));
    expect(result.rows[0]?.issues).toEqual([{ code: 'qty_negative' }]);
  });
});
