import { describe, expect, it } from 'vitest';
import type { SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';
import { unconfirmedAfter } from './unconfirmed-sends';

const UNCERTAIN: SaveDraftResult = { ok: false, error: 'uncertain' };
const draftNamed = (name: string) => ({ id: name }) as unknown as ProposalDraftState;
const names = (sends: readonly ProposalDraftState[]) => sends.map((sent) => sent.id).join(' ');

/** Drafts d1..dN, each answered uncertain in turn; the list is newest first. */
function afterLostSends(count: number): readonly ProposalDraftState[] {
  let sends: readonly ProposalDraftState[] = [];
  for (let n = 1; n <= count; n += 1) sends = unconfirmedAfter(sends, draftNamed(`d${n}`), UNCERTAIN);
  return sends;
}

describe('unconfirmedAfter', () => {
  it.each(['uncertain', 'generic'] as const)('an answer of %s adds the draft as the newest', (error) => {
    const earlier = afterLostSends(2);
    expect(names(unconfirmedAfter(earlier, draftNamed('d3'), { ok: false, error }))).toBe('d3 d2 d1');
  });

  it('an ok answer leaves nothing unconfirmed', () => {
    expect(unconfirmedAfter(afterLostSends(3), draftNamed('d4'), { ok: true })).toEqual([]);
  });

  it.each(['draft_changed_elsewhere', 'draft_incomplete', 'forbidden'] as const)(
    'a refusal of %s is known not to have committed: the list is handed back as it was',
    (error) => {
      const earlier = afterLostSends(2);
      expect(unconfirmedAfter(earlier, draftNamed('d3'), { ok: false, error })).toBe(earlier);
    },
  );

  it('the same draft sent again (Retry) is kept once, as the newest', () => {
    const earlier = afterLostSends(3);
    const retried = earlier[2];
    expect(names(unconfirmedAfter(earlier, retried, UNCERTAIN))).toBe('d1 d3 d2');
    expect(names(unconfirmedAfter(earlier, earlier[0], UNCERTAIN))).toBe('d3 d2 d1');
  });

  it('another draft with the same content is a send of its own', () => {
    const earlier = afterLostSends(1);
    expect(names(unconfirmedAfter(earlier, draftNamed('d1'), UNCERTAIN))).toBe('d1 d1');
  });

  it('does not change the list it was handed', () => {
    const earlier = afterLostSends(8);
    unconfirmedAfter(earlier, draftNamed('d9'), UNCERTAIN);
    expect(names(earlier)).toBe('d8 d7 d6 d5 d4 d3 d2 d1');
  });

  it('keeps 8 drafts at most', () => {
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

  it('a retry of a kept draft when the list is full drops nothing', () => {
    const full = afterLostSends(8);
    expect(names(unconfirmedAfter(full, full[7], UNCERTAIN))).toBe('d1 d8 d7 d6 d5 d4 d3 d2');
  });
});
