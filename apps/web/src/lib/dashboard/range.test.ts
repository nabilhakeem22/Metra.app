import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RANGE,
  fillMonths,
  monthsInRange,
  parseRange,
  RANGE_OPTIONS,
} from './range';

// Fixed "now" so these never drift with the wall clock.
const NOW = new Date(Date.UTC(2026, 8, 15)); // 2026-09-15

describe('parseRange', () => {
  it('accepts the offered windows', () => {
    for (const n of RANGE_OPTIONS) {
      expect(parseRange(String(n))).toBe(n);
    }
  });

  it('falls back to the default rather than erroring on junk', () => {
    // A hand-edited URL must not be able to break the dashboard.
    for (const junk of [undefined, '', 'abc', '0', '-6', '7', '999', 'NaN']) {
      expect(parseRange(junk)).toBe(DEFAULT_RANGE);
    }
  });

  it('takes the first value when the param repeats', () => {
    expect(parseRange(['12', '3'])).toBe(12);
  });
});

describe('monthsInRange', () => {
  it('ends with the CURRENT month and runs oldest-first', () => {
    expect(monthsInRange(3, NOW)).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('crosses a year boundary correctly', () => {
    expect(monthsInRange(6, new Date(Date.UTC(2026, 1, 10)))).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('returns exactly as many months as asked for', () => {
    for (const n of RANGE_OPTIONS) {
      expect(monthsInRange(n, NOW)).toHaveLength(n);
    }
  });
});

describe('fillMonths', () => {
  const empty = (month: string) => ({ month, active: 0, inactive: 0 });

  it('fills the months the query returned nothing for', () => {
    // The honesty case: Postgres only returns months that HAVE rows, so a quiet
    // month would simply be absent and the chart would draw straight through the
    // gap as though it never happened.
    const filled = fillMonths(
      [{ month: '2026-09', active: 4, inactive: 1 }],
      3,
      empty,
      NOW,
    );
    expect(filled).toEqual([
      { month: '2026-07', active: 0, inactive: 0 },
      { month: '2026-08', active: 0, inactive: 0 },
      { month: '2026-09', active: 4, inactive: 1 },
    ]);
  });

  it('keeps the real rows untouched', () => {
    const rows = [
      { month: '2026-08', active: 2, inactive: 0 },
      { month: '2026-09', active: 3, inactive: 5 },
    ];
    const filled = fillMonths(rows, 3, empty, NOW);
    expect(filled[1]).toEqual(rows[0]);
    expect(filled[2]).toEqual(rows[1]);
  });

  it('always returns one bucket per month, in order', () => {
    const filled = fillMonths([], 12, empty, NOW);
    expect(filled).toHaveLength(12);
    expect(filled.map((f) => f.month)).toEqual(monthsInRange(12, NOW));
  });

  it('ignores a row outside the window rather than widening the chart', () => {
    // The query is bounded, but a row from outside must not stretch the axis if
    // one ever slipped through.
    const filled = fillMonths(
      [
        { month: '2020-01', active: 99, inactive: 99 },
        { month: '2026-09', active: 1, inactive: 0 },
      ],
      3,
      empty,
      NOW,
    );
    expect(filled).toHaveLength(3);
    expect(filled.some((f) => f.month === '2020-01')).toBe(false);
  });
});
