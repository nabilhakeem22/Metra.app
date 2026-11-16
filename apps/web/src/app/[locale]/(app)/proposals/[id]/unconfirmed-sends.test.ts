import { describe, expect, it } from 'vitest';
import type { SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';
import { unconfirmedAfter, type UnconfirmedSend } from './unconfirmed-sends';

const UNCERTAIN: SaveDraftResult = { ok: false, error: 'uncertain' };
/** A send of a draft object of its own, sent as the snapshot `name` (or `snapshot`). */
const sendNamed = (name: string, snapshot = name): UnconfirmedSend => ({
  draft: { id: name } as unknown as ProposalDraftState,
  snapshot,
});
const names = (sends: readonly UnconfirmedSend[]) => sends.map((sent) => sent.draft.id).join(' ');

/** Sends d1..dN, each answered uncertain in turn; the list is newest first. */
function afterLostSends(count: number): readonly UnconfirmedSend[] {
  let sends: readonly UnconfirmedSend[] = [];
  for (let n = 1; n <= count; n += 1) sends = unconfirmedAfter(sends, sendNamed(`d${n}`), UNCERTAIN);
  return sends;
}

describe('unconfirmedAfter', () => {
  it.each(['uncertain', 'generic'] as const)('an answer of %s adds the send as the newest', (error) => {
    const earlier = afterLostSends(2);
    expect(names(unconfirmedAfter(earlier, sendNamed('d3'), { ok: false, error }))).toBe('d3 d2 d1');
  });

  it('an ok answer leaves nothing unconfirmed', () => {
    expect(unconfirmedAfter(afterLostSends(3), sendNamed('d4'), { ok: true })).toEqual([]);
  });

  it.each(['draft_changed_elsewhere', 'draft_incomplete', 'forbidden'] as const)(
    'a refusal of %s is known not to have committed: the list is handed back as it was',
    (error) => {
      const earlier = afterLostSends(2);
      expect(unconfirmedAfter(earlier, sendNamed('d3'), { ok: false, error })).toBe(earlier);
    },
  );

  it('the same send again (Retry) is kept once, as the newest', () => {
    const earlier = afterLostSends(3);
    expect(names(unconfirmedAfter(earlier, earlier[2], UNCERTAIN))).toBe('d1 d3 d2');
    expect(names(unconfirmedAfter(earlier, earlier[0], UNCERTAIN))).toBe('d3 d2 d1');
  });

  it('another draft object sent as the same snapshot is the same send: kept once, the newer object, as the newest', () => {
    const earlier = afterLostSends(3);
    const again = sendNamed('d1 again', 'd1');
    const after = unconfirmedAfter(earlier, again, UNCERTAIN);
    expect(names(after)).toBe('d1 again d3 d2');
    expect(after[0]).toBe(again);
  });

  it('the same draft object sent as another snapshot is a send of its own', () => {
    const [first] = afterLostSends(1);
    const rekeyed: UnconfirmedSend = { draft: first.draft, snapshot: 'd1 with ids' };
    expect(unconfirmedAfter([first], rekeyed, UNCERTAIN)).toEqual([rekeyed, first]);
  });

  it('six retries of one draft, a new object each time, take one place: the earlier sends stay', () => {
    let sends = afterLostSends(3);
    for (let n = 1; n <= 6; n += 1) sends = unconfirmedAfter(sends, sendNamed(`d3 retry ${n}`, 'd3'), UNCERTAIN);
    expect(names(sends)).toBe('d3 retry 6 d2 d1');
  });

  it('does not change the list it was handed', () => {
    const earlier = afterLostSends(8);
    unconfirmedAfter(earlier, sendNamed('d9'), UNCERTAIN);
    unconfirmedAfter(earlier, sendNamed('d4 again', 'd4'), UNCERTAIN);
    expect(names(earlier)).toBe('d8 d7 d6 d5 d4 d3 d2 d1');
  });

  it('keeps 8 sends at most', () => {
    expect(afterLostSends(7)).toHaveLength(7);
    expect(afterLostSends(8)).toHaveLength(8);
    expect(afterLostSends(9)).toHaveLength(8);
    expect(afterLostSends(40)).toHaveLength(8);
  });

  it('past the bound the first send and the newest seven stay; the one dropped is the oldest but one', () => {
    expect(names(afterLostSends(9))).toBe('d9 d8 d7 d6 d5 d4 d3 d1');
    expect(names(afterLostSends(10))).toBe('d10 d9 d8 d7 d6 d5 d4 d1');
    expect(names(afterLostSends(40))).toBe('d40 d39 d38 d37 d36 d35 d34 d1');
  });

  it('a retry of a kept send when the list is full drops nothing', () => {
    const full = afterLostSends(8);
    expect(names(unconfirmedAfter(full, full[7], UNCERTAIN))).toBe('d1 d8 d7 d6 d5 d4 d3 d2');
    expect(names(unconfirmedAfter(full, sendNamed('d2 again', 'd2'), UNCERTAIN))).toBe('d2 again d8 d7 d6 d5 d4 d3 d1');
  });
});
