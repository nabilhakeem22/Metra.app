import { describe, expect, test } from 'vitest';
import type { EditableLine } from './boq-sheet-columns';
import { recordValue, trimNumber } from './boq-sheet-columns';

function lineWith(overrides: Partial<EditableLine> = {}): EditableLine {
  return {
    id: 'line-1',
    sectionId: 'section-1',
    itemCode: '2.03.1',
    description: 'سقف جبسوم بورد',
    unit: 'sqm',
    qty: '4.0000',
    unitPrice: '2500.5000',
    discountPct: '0.0000',
    lineTotal: '10002.0000',
    provisional: false,
    ...overrides,
  };
}

describe('trimNumber', () => {
  test.each([
    ['8.5000', '8.5'],
    ['0.0000', '0'],
    ['12', '12'],
    ['1500.0000', '1500'],
    ['0.0001', '0.0001'],
    ['.5000', '.5'],
  ])('%s -> %s', (stored, expected) => {
    expect(trimNumber(stored)).toBe(expected);
  });

  // PINNED, NOT ENDORSED. '-0.0000' trims to '-0', not '0': the guard only
  // rescues '' and '-'. This is the behaviour of the function as it stood before
  // the move and the move must not change it, so it is recorded here rather than
  // quietly corrected inside a commit whose whole claim is that nothing changed.
  // Negative stored quantities are the only way to reach it.
  test("'-0.0000' trims to '-0' — the pre-move behaviour, pinned", () => {
    expect(trimNumber('-0.0000')).toBe('-0');
  });
});

describe('recordValue — the ONE switch', () => {
  test('itemCode', () => {
    expect(recordValue(lineWith(), 'itemCode')).toBe('2.03.1');
  });

  test('a null itemCode becomes the empty string, never the word null', () => {
    expect(recordValue(lineWith({ itemCode: null }), 'itemCode')).toBe('');
  });

  test('description is returned verbatim', () => {
    expect(recordValue(lineWith(), 'description')).toBe('سقف جبسوم بورد');
  });

  test('unit is returned verbatim', () => {
    expect(recordValue(lineWith(), 'unit')).toBe('sqm');
  });

  test('qty and unitPrice come back TRIMMED — what a studio would type', () => {
    expect(recordValue(lineWith(), 'qty')).toBe('4');
    expect(recordValue(lineWith(), 'unitPrice')).toBe('2500.5');
  });

  test('the trimmed form is what a blur compares against, so a retype is a no-op', () => {
    const line = lineWith();
    expect(recordValue(line, 'qty')).toBe(trimNumber(line.qty));
  });
});
