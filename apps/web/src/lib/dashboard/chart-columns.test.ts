import { describe, expect, it, vi, afterEach } from 'vitest';
import { clientColumns, projectColumns, sliceTotals } from './chart-columns';

// The label is injected, so these cases carry no locale and no Intl: `month` in,
// `month` out, and the assertions are about the ARITHMETIC — which is the part a
// tester can falsify and the part that had no test while it lived in page.tsx.
const label = (month: string) => month;

afterEach(() => {
  vi.useRealTimers();
});

/** Pin "now" so the six-month window is a known set of months. */
function freezeAt(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('projectColumns', () => {
  it('returns one column per month in the window, oldest first', () => {
    freezeAt('2026-06-15T00:00:00Z');
    const columns = projectColumns([], 6, label);
    expect(columns.map((c) => c.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
  });

  it('ZEROES a month Postgres returned nothing for', () => {
    // The honesty property: a quiet March must not be absent, or the chart draws
    // February straight into April as though the gap never happened.
    freezeAt('2026-06-15T00:00:00Z');
    const columns = projectColumns(
      [{ month: '2026-04', active: 3, completed: 1, other: 0 }],
      6,
      label,
    );
    const march = columns.find((c) => c.month === '2026-03');
    expect(march?.segments).toEqual([
      { key: 'active', value: 0 },
      { key: 'completed', value: 0 },
      { key: 'other', value: 0 },
    ]);
    const april = columns.find((c) => c.month === '2026-04');
    expect(april?.segments).toEqual([
      { key: 'active', value: 3 },
      { key: 'completed', value: 1 },
      { key: 'other', value: 0 },
    ]);
  });

  it('renders the label the caller gives it and nothing else', () => {
    freezeAt('2026-06-15T00:00:00Z');
    const columns = projectColumns([], 3, (month) => `<${month}>`);
    expect(columns.map((c) => c.label)).toEqual(['<2026-04>', '<2026-05>', '<2026-06>']);
  });
});

describe('clientColumns', () => {
  it('carries the two client segments, zeroed where there is no data', () => {
    freezeAt('2026-06-15T00:00:00Z');
    const columns = clientColumns(
      [{ month: '2026-06', active: 2, inactive: 5 }],
      3,
      label,
    );
    expect(columns).toHaveLength(3);
    expect(columns[2].segments).toEqual([
      { key: 'active', value: 2 },
      { key: 'inactive', value: 5 },
    ]);
    expect(columns[0].segments).toEqual([
      { key: 'active', value: 0 },
      { key: 'inactive', value: 0 },
    ]);
  });
});

describe('sliceTotals', () => {
  it('sums each key across the WHOLE window the bars covered', () => {
    freezeAt('2026-06-15T00:00:00Z');
    const columns = projectColumns(
      [
        { month: '2026-05', active: 2, completed: 1, other: 0 },
        { month: '2026-06', active: 3, completed: 0, other: 4 },
      ],
      3,
      label,
    );
    expect(sliceTotals(columns, ['active', 'completed', 'other'])).toEqual([
      { key: 'active', value: 5 },
      { key: 'completed', value: 1 },
      { key: 'other', value: 4 },
    ]);
  });

  it('answers 0 for a key no column carries, rather than dropping the slice', () => {
    // The legend is built from the same key list; a vanishing slice would make
    // the legend and the arithmetic disagree about how many categories exist.
    freezeAt('2026-06-15T00:00:00Z');
    const columns = clientColumns([], 3, label);
    expect(sliceTotals(columns, ['active', 'inactive', 'invented'])).toEqual([
      { key: 'active', value: 0 },
      { key: 'inactive', value: 0 },
      { key: 'invented', value: 0 },
    ]);
  });

  it('sums an empty window to zero without throwing', () => {
    expect(sliceTotals([], ['active'])).toEqual([{ key: 'active', value: 0 }]);
  });
});
