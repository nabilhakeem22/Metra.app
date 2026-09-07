import { describe, expect, it } from 'vitest';
import { decodeCsv } from './decode';
import { autoDetectMapping, mapRows } from './map';
import { buildTemplateCsv, templateFilename, TEMPLATE_UNITS } from './template';

describe('buildTemplateCsv', () => {
  it('starts with a BOM so Excel does not mangle Arabic', () => {
    // Without it, a double-clicked CSV is read in the system ANSI codepage and
    // every Arabic description in the downloaded template is mojibake.
    expect(buildTemplateCsv().charCodeAt(0)).toBe(0xfeff);
  });

  it('uses CRLF, Excel’s own dialect', () => {
    expect(buildTemplateCsv()).toContain('\r\n');
  });

  it('can omit the example row', () => {
    const withExample = decodeCsv(buildTemplateCsv()).grid.rows;
    const bare = decodeCsv(buildTemplateCsv({ includeExample: false })).grid.rows;
    expect(withExample).toHaveLength(2);
    expect(bare).toHaveLength(1);
  });

  it('quotes a value containing a comma', () => {
    // Most real descriptions contain one; unquoted it becomes two columns.
    const line = buildTemplateCsv().split('\r\n')[1] ?? '';
    expect(line).toContain('"12mm gypsum ceiling, suspended"');
  });
});

describe('the template round trip', () => {
  it('maps itself with nothing left for the studio to confirm', () => {
    // The headers ARE the contract between the writer and auto-detection. If
    // either side drifts, the returned template stops mapping itself and the
    // whole "fill it and upload it" flow acquires a manual step.
    const { grid } = decodeCsv(buildTemplateCsv());
    const mapping = autoDetectMapping(grid.rows[0] as string[]);
    for (const [field, index] of Object.entries(mapping)) {
      expect(index, `${field} should auto-detect`).toBeGreaterThanOrEqual(0);
    }
  });

  it('imports its own example row as a valid line', () => {
    const { grid } = decodeCsv(buildTemplateCsv());
    const res = mapRows(grid, autoDetectMapping(grid.rows[0] as string[]));
    expect(res.errorCount).toBe(0);
    expect(res.ok[0]).toMatchObject({
      section: 'Gypsum works',
      unit: 'sqm',
      qty: '100',
      unitPrice: '1500',
      unitCost: '900',
      provisional: false,
    });
  });

  it('surfaces the example row in the preview rather than hiding it', () => {
    // It is deleted by the studio, not by us — but only if they can see it.
    const { grid } = decodeCsv(buildTemplateCsv());
    const res = mapRows(grid, autoDetectMapping(grid.rows[0] as string[]));
    expect(res.ok[0]?.itemCode).toContain('delete this row');
  });

  it('survives a studio filling it in Arabic', () => {
    // The realistic case: they keep our headers and type their own content.
    const filled = `${buildTemplateCsv({ includeExample: false })}2.01,أعمال الجبس,سقف جبسي,متر مربع,١٢٠,١٥٠٠,٩٠٠,نعم,\r\n`;
    const { grid } = decodeCsv(filled);
    const res = mapRows(grid, autoDetectMapping(grid.rows[0] as string[]));
    expect(res.errorCount).toBe(0);
    expect(res.ok[0]).toMatchObject({
      section: 'أعمال الجبس',
      description: 'سقف جبسي',
      unit: 'sqm',
      qty: '120',
      unitPrice: '1500',
      provisional: true,
    });
  });

  it('survives Excel re-saving it with semicolons', () => {
    // Egyptian Windows writes `a;b;c`. The template goes out comma-separated and
    // can come back either way depending on the machine that saved it.
    const csv = buildTemplateCsv({ includeExample: false }).trimEnd();
    const semi = `${csv.split(',').join(';')}\r\n2.01;Painting;Walls;sqm;50;85;40;no;\r\n`;
    const { grid, notes } = decodeCsv(semi);
    const res = mapRows(grid, autoDetectMapping(grid.rows[0] as string[]));
    expect(notes).toContain('Read as semicolon-separated.');
    expect(res.errorCount).toBe(0);
    expect(res.ok[0]?.description).toBe('Walls');
  });

  it('offers only units the importer accepts', () => {
    // A template that suggests a unit the mapper rejects is a trap.
    const { grid } = decodeCsv(buildTemplateCsv({ includeExample: false }));
    const mapping = autoDetectMapping(grid.rows[0] as string[]);
    const rows = TEMPLATE_UNITS.map((u) => `x,S,Desc,${u},1,1,0,no,`).join('\r\n');
    const res = mapRows(
      decodeCsv(`${buildTemplateCsv({ includeExample: false })}${rows}`).grid,
      mapping,
    );
    expect(res.errorCount).toBe(0);
    expect(res.ok).toHaveLength(TEMPLATE_UNITS.length);
  });
});

describe('templateFilename', () => {
  it('names the file after the project when there is one', () => {
    expect(templateFilename('P-2026-0007')).toBe('boq-template-P-2026-0007.csv');
  });

  it('falls back to a generic name', () => {
    expect(templateFilename(null)).toBe('metra-boq-template.csv');
  });

  it('strips characters a filesystem would reject', () => {
    expect(templateFilename('a/b:c*d')).toBe('boq-template-a-b-c-d.csv');
  });
});
