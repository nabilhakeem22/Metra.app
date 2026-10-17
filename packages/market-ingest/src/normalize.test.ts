import { describe, expect, it } from 'vitest';
import { canonicalDecimal, sourceLabelOf, verbatimCellNumber } from './normalize';

describe('normalize', () => {
  it('builds the matching label from name and spec', () => {
    expect(sourceLabelOf('أسلاك نحاس معزول', '٢ مم')).toBe('اسلاك نحاس معزول 2 مم');
    expect(sourceLabelOf('حديد التسليح', null)).toBe('حديد التسليح');
  });

  it('canonicalises decimals', () => {
    expect(canonicalDecimal('11.10')).toBe('11.1');
    expect(canonicalDecimal('007')).toBe('7');
    expect(canonicalDecimal('5.0')).toBe('5');
    expect(canonicalDecimal('0.5')).toBe('0.5');
  });

  it('reads a printed cell: Arabic-Indic digits, the comma as the decimal mark', () => {
    expect(verbatimCellNumber('١١،١')).toBe('11.1');
    expect(verbatimCellNumber('١٠،٣٧٤')).toBe('10.374');
    expect(verbatimCellNumber('٣٩٨٥٠')).toBe('39850');
    expect(verbatimCellNumber(' ١٦٣٫٣٦ ')).toBe('163.36');
    expect(verbatimCellNumber('30.455')).toBe('30.455');
  });

  it('refuses a cell that is not one number', () => {
    expect(verbatimCellNumber('التسعير متوقف')).toBeNull();
    expect(verbatimCellNumber('1,026,5')).toBeNull();
    expect(verbatimCellNumber('')).toBeNull();
  });
});
