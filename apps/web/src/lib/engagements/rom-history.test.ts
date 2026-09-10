import { describe, expect, it } from 'vitest';
import type { EngagementEventRecord } from './queries';
import { romHistory } from './rom-history';

function event(over: Partial<EngagementEventRecord>): EngagementEventRecord {
  return {
    id: 'e1',
    kind: 'rom_range_set',
    actorUserId: 'u1',
    actorChannel: 'staff',
    docHash: null,
    note: null,
    rangeLow: '1500000.0000',
    rangeHigh: '2500000.0000',
    decidedAt: new Date('2026-08-14T10:00:00Z'),
    createdAt: new Date('2026-08-14T10:00:00Z'),
    ...over,
  };
}

describe('romHistory', () => {
  it('keeps both ROM kinds and drops everything else', () => {
    const entries = romHistory([
      event({ id: 'set', kind: 'rom_range_set' }),
      event({ id: 'ack', kind: 'rom_acknowledgement' }),
      event({ id: 'concept', kind: 'concept_approval', rangeLow: null, rangeHigh: null }),
      event({ id: 'design', kind: 'design_approval', rangeLow: null, rangeHigh: null }),
    ]);
    expect(entries.map((e) => e.id)).toEqual(['set', 'ack']);
  });

  it('orders newest first regardless of the input order', () => {
    // The Budget tab reads the SAME event array the Timeline does, and the two
    // want different orders — so this sorts rather than trusting the caller.
    const entries = romHistory([
      event({ id: 'aug', decidedAt: new Date('2026-08-14T10:00:00Z') }),
      event({ id: 'oct', decidedAt: new Date('2026-10-02T10:00:00Z') }),
      event({ id: 'sep', decidedAt: new Date('2026-09-06T10:00:00Z') }),
    ]);
    expect(entries.map((e) => e.id)).toEqual(['oct', 'sep', 'aug']);
  });

  it('keeps a superseded band rather than only the latest', () => {
    // The whole reason this tab exists. A studio's exposure on a non-binding
    // figure is "what did we tell them in August", and the answer must survive
    // every revision after it.
    const entries = romHistory([
      event({ id: 'coarse', rangeLow: '1500000.0000', rangeHigh: '2500000.0000' }),
      event({
        id: 'tight',
        rangeLow: '1800000.0000',
        rangeHigh: '2200000.0000',
        decidedAt: new Date('2026-09-06T10:00:00Z'),
      }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ low: '1500000.0000', high: '2500000.0000' });
  });

  it('drops a half-range instead of rendering one', () => {
    // Neither write path can produce one — the ack fails `rom_not_set` first and
    // the set validates both bounds — so a partial row is data that predates or
    // bypassed both, and a range with one end missing is not a range.
    const entries = romHistory([
      event({ id: 'lowOnly', rangeHigh: null }),
      event({ id: 'highOnly', rangeLow: null }),
      event({ id: 'whole' }),
    ]);
    expect(entries.map((e) => e.id)).toEqual(['whole']);
  });

  it('breaks a same-millisecond tie by insert order, then by id', () => {
    // postgres.js truncates timestamptz to JS millisecond precision, so two events
    // CAN tie on decidedAt. Resolving that by sort stability alone would be a
    // claim about the caller's ordering, which is exactly what this module exists
    // not to make. Same order the guard readers already use for this table.
    const tied = new Date('2026-09-06T10:00:00Z');
    const entries = romHistory([
      event({ id: 'a', decidedAt: tied, createdAt: new Date('2026-09-06T10:00:00.000Z') }),
      event({ id: 'c', decidedAt: tied, createdAt: new Date('2026-09-06T10:00:02.000Z') }),
      event({ id: 'b', decidedAt: tied, createdAt: new Date('2026-09-06T10:00:01.000Z') }),
    ]);
    expect(entries.map((e) => e.id)).toEqual(['c', 'b', 'a']);

    // Tied on BOTH: id decides, so the order is stable across processes rather
    // than dependent on the order rows happened to arrive in. Descending, like
    // every other leg of this comparator and like `guards/readiness.ts` — the
    // direction carries no meaning, only determinism, so matching the one the
    // codebase already uses is the whole point.
    const both = romHistory([
      event({ id: 'aa', decidedAt: tied, createdAt: tied }),
      event({ id: 'zz', decidedAt: tied, createdAt: tied }),
    ]);
    expect(both.map((e) => e.id)).toEqual(['zz', 'aa']);
  });

  it('is empty for an engagement that has never had a range', () => {
    expect(romHistory([])).toEqual([]);
    expect(
      romHistory([event({ kind: 'concept_approval', rangeLow: null, rangeHigh: null })]),
    ).toEqual([]);
  });
});
