import { describe, expect, it } from 'vitest';
import { FORMULA_GUARD, neutralizeFormula, stripFormulaGuard } from './formula-guard';

describe('neutralizeFormula', () => {
  it.each(['=1+1', '+1', '-2+3', '@SUM(A1)', '\tx', '\rx', "=cmd|' /C calc'!A0"])('guards %j', (cell) => {
    expect(neutralizeFormula(cell)).toBe(`${FORMULA_GUARD}${cell}`);
  });

  it.each(['-5', '12.5', '-0.75', 'abc', '', "'abc"])('leaves %j alone', (cell) => {
    expect(neutralizeFormula(cell)).toBe(cell);
  });
});

describe('stripFormulaGuard', () => {
  it('undoes the guard on every triggered cell', () => {
    for (const cell of ['=1+1', '+1', '-2+3', '@SUM(A1)', '\tx', '\rx']) {
      expect(stripFormulaGuard(neutralizeFormula(cell))).toBe(cell);
    }
  });

  it('keeps an apostrophe that guards nothing', () => {
    expect(stripFormulaGuard("'abc")).toBe("'abc");
    expect(stripFormulaGuard("'")).toBe("'");
  });

  it('drops only ONE guard', () => {
    expect(stripFormulaGuard("''=1")).toBe("''=1");
    expect(stripFormulaGuard("'=1")).toBe('=1');
  });
});
