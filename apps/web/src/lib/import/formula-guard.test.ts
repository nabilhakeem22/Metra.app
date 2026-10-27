import { describe, expect, it } from 'vitest';
import { FORMULA_GUARD, neutralizeFormula, stripFormulaGuard } from './formula-guard';

/** Fix round T8: the payloads the security test emitted unguarded. */
const FULL_WIDTH = ['＝1+1', '＋cmd', '－2+3', '＠SUM(A1)', '﹦1+1'];
const BEHIND_INVISIBLES = [' =1+1', ' =1+1', '​=1+1', '﻿=1+1', '\n=1+1', '​  ＝HYPERLINK("http://x")', '‮=1+1'];

describe('neutralizeFormula', () => {
  it.each(['=1+1', '+1', '-2+3', '@SUM(A1)', '\tx', '\rx', "=cmd|' /C calc'!A0"])('guards %j', (cell) => {
    expect(neutralizeFormula(cell)).toBe(`${FORMULA_GUARD}${cell}`);
  });

  it.each(FULL_WIDTH)('guards the full-width trigger in %j (T8)', (cell) => {
    expect(neutralizeFormula(cell)).toBe(`${FORMULA_GUARD}${cell}`);
  });

  it.each(BEHIND_INVISIBLES)('guards a trigger behind leading invisible characters in %j (T8)', (cell) => {
    expect(neutralizeFormula(cell)).toBe(`${FORMULA_GUARD}${cell}`);
  });

  it.each(['-5', '12.5', '-0.75', ' -5', '－5', 'abc', '', "'abc", '​abc', 'a=1'])('leaves %j alone', (cell) => {
    expect(neutralizeFormula(cell)).toBe(cell);
  });
});

describe('stripFormulaGuard', () => {
  it('undoes the guard on every triggered cell, the T8 payloads included', () => {
    for (const cell of ['=1+1', '+1', '-2+3', '@SUM(A1)', '\tx', '\rx', ...FULL_WIDTH, ...BEHIND_INVISIBLES]) {
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
