import { describe, expect, it } from 'vitest';
import { CASED_RANGES, DELETED_RANGES, caseTable } from './compare-sql';

// The tables comparisonFormSql folds with, against THIS runtime's Unicode. The
// SQL itself is checked against comparisonForm in Postgres
// (apps/web/tests/actions/market-name-clash-sql.dbtest.ts).

const LAST_CODE_POINT = 0x10ffff;
const isSurrogate = (point: number) => point >= 0xd800 && point <= 0xdfff;
const hex = (point: number) => point.toString(16).padStart(4, '0');

function codePointsOf(ranges: string[]): Set<number> {
  const points = new Set<number>();
  for (const range of ranges) {
    const [start, end = start] = range.split('-').map((part) => Number.parseInt(part, 16));
    for (let point = start; point <= end; point += 1) points.add(point);
  }
  return points;
}

function everyCodePoint(test: (character: string) => boolean): number[] {
  const points: number[] = [];
  for (let point = 0; point <= LAST_CODE_POINT; point += 1) {
    if (!isSurrogate(point) && test(String.fromCodePoint(point))) points.push(point);
  }
  return points;
}

/** `points` (ascending) as the hex ranges DELETED_RANGES is written in: what to paste when this runtime's Unicode moved. */
function asRanges(points: number[]): string {
  const ranges: Array<[number, number]> = [];
  for (const point of points) {
    const last = ranges.at(-1);
    if (last && last[1] === point - 1) last[1] = point;
    else ranges.push([point, point]);
  }
  return ranges.map(([start, end]) => (start === end ? hex(start) : `${hex(start)}-${hex(end)}`)).join(' ');
}

describe('the tables comparisonFormSql folds with', () => {
  it('deletes exactly what comparisonForm deletes: every format character, non-spacing mark and tatweel', () => {
    const deleted = everyCodePoint((character) => /\p{Mn}|\p{Cf}|\u0640/u.test(character));
    expect(asRanges([...codePointsOf(DELETED_RANGES)].sort((a, b) => a - b))).toBe(asRanges(deleted));
  });

  it('reads the case table from blocks holding every non-ASCII character toLowerCase changes', () => {
    const cased = codePointsOf(CASED_RANGES);
    const changed = everyCodePoint((character) => character.toLowerCase() !== character).filter((point) => point > 0x7f);
    expect(changed.filter((point) => !cased.has(point)).map(hex)).toEqual([]);
    expect([...cased].filter((point) => point <= 0x7f)).toEqual([]);
  });

  it('lowers every character a name can hold after NFKC as toLowerCase does, ς as σ the one difference', () => {
    const table = caseTable();
    const lowers = [...table.to];
    const lowered = new Map([...table.from].map((character, index) => [character, lowers[index]]));
    const asSql = (character: string) =>
      character === 'İ' ? 'i\u0307' : (lowered.get(character) ?? character.replace(/[A-Z]/, (capital) => capital.toLowerCase()));
    const differing = everyCodePoint((character) => character.normalize('NFKC') === character)
      .map((point) => String.fromCodePoint(point))
      .filter((character) => asSql(character) !== character.toLowerCase().replace(/ς/g, 'σ'));
    expect(differing.map((character) => hex(character.codePointAt(0)!))).toEqual([]);
  });

  it('maps one character to one in the table, and folds the final sigma toLowerCase writes in context', () => {
    const table = caseTable();
    expect([...table.from]).toHaveLength([...table.to].length);
    expect(new Set(table.from).size).toBe([...table.from].length);
    expect('ΟΔΟΣ'.toLowerCase()).toBe('οδος');
    expect(table.from.includes('ς') && table.from.includes('Σ')).toBe(true);
  });
});
