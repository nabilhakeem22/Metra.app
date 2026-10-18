import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { MAX_SEARCH_WORDS, STRIPPED_MARKS, searchWords } = await import('./search-sql');
const { searchForm } = await import('./name-order');

/** Every code point the SQL class lists, ranges expanded. */
function strippedCodePoints(): number[] {
  const body = [...STRIPPED_MARKS.slice(1, -1)];
  const points: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const start = body[index].codePointAt(0)!;
    if (body[index + 1] === '-') {
      const end = body[index + 2].codePointAt(0)!;
      for (let point = start; point <= end; point += 1) points.push(point);
      index += 2;
    } else {
      points.push(start);
    }
  }
  return points;
}

describe('the SQL search folds as searchForm does', () => {
  it('strips in SQL only what searchForm strips (never a letter a studio typed)', () => {
    const points = strippedCodePoints();
    expect(points.length).toBeGreaterThan(300);
    for (const point of points) {
      expect(searchForm(`1${String.fromCodePoint(point)}2`), `U+${point.toString(16)}`).toBe('12');
    }
  });

  it('applies the typed words in searchForm form, at most MAX_SEARCH_WORDS of them', () => {
    expect(searchWords('  نحاس   معزول ٢  ')).toEqual(['نحاس', 'معزول', '2']);
    expect(searchWords('')).toEqual([]);
    expect(searchWords('a b c d e f g h i j')).toHaveLength(MAX_SEARCH_WORDS);
  });
});
