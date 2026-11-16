import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_ANSWER, settleWithinDeadline } from './draft-answer-deadline';
import { createDraftSaveFlight } from './draft-save-flight';
import type { SaveDraft, SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

// A server call can resolve with NOTHING where its type promises a result (the
// request was answered by something other than the action). Before the save had
// a deadline the flight read `.ok` of that inside its `try`, so an empty answer
// was a save whose answer never came back: `uncertain`, and remembered. It
// still is: an empty answer is no answer.

const lostCommit = vi.hoisted(() => ({
  recover: (..._drafts: unknown[]): Promise<unknown> => Promise.resolve(null),
}));
vi.mock('./lost-commit', () => ({
  recoverLostCommit: (...drafts: unknown[]) => lostCommit.recover(...drafts),
}));

const STALE: SaveDraftResult = { ok: false, error: 'draft_changed_elsewhere' };
const draftNamed = (name: string) => ({ id: name }) as unknown as ProposalDraftState;
const noIds = (): void => undefined;
const told = (answer: unknown): string => (answer === NO_ANSWER ? 'no answer' : `answered ${String(answer)}`);

/** A flight whose saves answer what `answers` holds, in order, typed or not. */
function flightAnswering(answers: unknown[]) {
  const save = vi.fn<SaveDraft>(() => Promise.resolve(answers.shift() as SaveDraftResult));
  const recover = vi.fn((..._drafts: unknown[]): Promise<unknown> => Promise.resolve(null));
  lostCommit.recover = recover;
  const flight = createDraftSaveFlight(() => null, { revision: 'r1', stored: 'snap-stored' });
  return { flight, save, recover };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('settleWithinDeadline: an empty answer', () => {
  it.each([[undefined], [null]])('an answer of %s is no answer, at once, and leaves no timer', async (empty) => {
    const settle = vi.fn(told);
    const settled = settleWithinDeadline(() => Promise.resolve(empty), 1_000, settle);
    await expect(settled).resolves.toBe('no answer');
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith(NO_ANSWER);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([[''], [0], [false]])('an answer of %j is merely falsy: it is the answer', async (falsy) => {
    const settle = vi.fn(told);
    await settleWithinDeadline(() => Promise.resolve(falsy), 1_000, settle);
    expect(settle).toHaveBeenCalledWith(falsy);
  });
});

describe('createDraftSaveFlight: a save that answers nothing', () => {
  it.each([[undefined], [null]])('an answer of %s is answered uncertain, with the draft it sent', async (empty) => {
    const { flight, save } = flightAnswering([empty]);
    const draft = draftNamed('a');
    const answer = await flight.send(save, draft, 'snap-a', noIds);
    expect(answer).toEqual({ result: { ok: false, error: 'uncertain' }, sent: draft });
    expect(answer.sent).toBe(draft);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('that save is remembered as unconfirmed: the next stale refusal asks whose commit is stored', async () => {
    const { flight, save, recover } = flightAnswering([undefined, STALE]);
    const first = draftNamed('a');
    const second = draftNamed('b');
    await flight.send(save, first, 'snap-a', noIds);
    expect((await flight.send(save, second, 'snap-b', noIds)).result).toBe(STALE);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover.mock.calls[0]?.[0]).toBe(first);
    expect(recover.mock.calls[0]?.[1]).toBe(second);
  });
});
