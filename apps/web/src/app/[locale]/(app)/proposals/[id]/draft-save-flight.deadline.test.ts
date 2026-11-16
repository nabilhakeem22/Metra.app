import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, type Deferred } from '@/test/turn-journal';
import { collectUnhandledRejections } from '@/test/unhandled-rejections';
import { createDraftSaveFlight } from './draft-save-flight';
import type { SaveDraft, SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

// The deadline of a draft save, at the flight: a save with no answer after 20 s
// is answered `uncertain` and remembered exactly as a save that threw, the
// flight is free again, and whatever the abandoned save answers later is dropped.

const lostCommit = vi.hoisted(() => ({
  recover: (..._drafts: unknown[]): Promise<unknown> => Promise.resolve(null),
}));
vi.mock('./lost-commit', () => ({
  recoverLostCommit: (...drafts: unknown[]) => lostCommit.recover(...drafts),
}));

const STALE: SaveDraftResult = { ok: false, error: 'draft_changed_elsewhere' };
const UNCERTAIN: SaveDraftResult = { ok: false, error: 'uncertain' };
const draftNamed = (name: string) => ({ id: name }) as unknown as ProposalDraftState;
const noIds = (): void => undefined;

/** A flight whose every save is answered by hand, oldest first in `answers`. */
function heldFlight() {
  const answers: Deferred<SaveDraftResult>[] = [];
  const save = vi.fn<SaveDraft>(() => {
    const answer = deferred<SaveDraftResult>();
    answers.push(answer);
    return answer.promise;
  });
  const recover = vi.fn((..._drafts: unknown[]): Promise<unknown> => Promise.resolve(null));
  lostCommit.recover = recover;
  let sends = 0;
  const flight = createDraftSaveFlight(
    () => {
      sends += 1;
      return flight.send(save, draftNamed(`background-${sends}`), `snap-${sends}`, noIds);
    },
    { revision: 'r1', stored: 'snap-stored' },
  );
  return { flight, save, answers, recover };
}

const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createDraftSaveFlight: a save has 20 seconds to answer', () => {
  it('an answer 1 ms before the deadline is the answer, the very object, and its timer is gone', async () => {
    const { flight, save, answers } = heldFlight();
    const answer: SaveDraftResult = { ok: true };
    const sending = flight.send(save, draftNamed('a'), 'snap-a', noIds);
    await pass(19_999);
    answers[0].resolve(answer);
    expect((await sending).result).toBe(answer);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('at 20,000 ms a save with no answer is answered uncertain, with the draft it sent', async () => {
    const { flight, save } = heldFlight();
    const draft = draftNamed('a');
    let answered: unknown = 'waiting';
    void flight.send(save, draft, 'snap-a', noIds).then((answer) => {
      answered = answer;
    });
    await pass(19_999);
    expect(answered).toBe('waiting');
    await pass(1);
    expect(answered).toEqual({ result: UNCERTAIN, sent: draft });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the save given up on is remembered as unconfirmed: the next stale refusal asks whose commit is stored', async () => {
    const { flight, save, answers, recover } = heldFlight();
    const first = draftNamed('a');
    const second = draftNamed('b');
    void flight.send(save, first, 'snap-a', noIds);
    await pass(20_000);
    const sending = flight.send(save, second, 'snap-b', noIds);
    answers[1].resolve(STALE);
    expect((await sending).result).toBe(STALE);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover.mock.calls[0]?.[0]).toBe(first);
    expect(recover.mock.calls[0]?.[1]).toBe(second);
  });

  it('an ok that arrives after the deadline is dropped: the draft is still unconfirmed', async () => {
    const { flight, save, answers, recover } = heldFlight();
    void flight.send(save, draftNamed('a'), 'snap-a', noIds);
    await pass(20_000);
    answers[0].resolve({ ok: true });
    await pass(0);
    const sending = flight.send(save, draftNamed('b'), 'snap-b', noIds);
    answers[1].resolve(STALE);
    await sending;
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('a rejection that arrives after the deadline is dropped, and is not left unhandled', async () => {
    const unhandled = collectUnhandledRejections();
    const { flight, save, answers } = heldFlight();
    const sending = flight.send(save, draftNamed('a'), 'snap-a', noIds);
    await pass(20_000);
    answers[0].reject(new Error('the connection dropped'));
    expect((await sending).result).toEqual(UNCERTAIN);
    expect(await unhandled.stop()).toEqual([]);
  });

  it('the save sent again after a recovery has 20 seconds of its own', async () => {
    const { flight, save, answers, recover } = heldFlight();
    const rekeyed = draftNamed('b+ids');
    recover.mockResolvedValueOnce({ revision: 'r2', idsByKey: new Map(), draft: rekeyed });
    void flight.send(save, draftNamed('a'), 'snap-a', noIds);
    await pass(20_000);
    let answered: unknown = 'waiting';
    void flight.send(save, draftNamed('b'), 'snap-b', noIds).then((answer) => {
      answered = answer;
    });
    answers[1].resolve(STALE);
    await pass(19_999);
    expect(save).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenLastCalledWith(rekeyed, 'r2');
    expect(answered).toBe('waiting');
    await pass(1);
    expect(answered).toEqual({ result: UNCERTAIN, sent: rekeyed });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createDraftSaveFlight: a save that never answers no longer holds the flight (R1)', () => {
  it('the queued request runs at the deadline, and a flush then waits one deadline at most', async () => {
    const { flight, save } = heldFlight();
    flight.request();
    flight.request();
    await pass(19_999);
    expect(save).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(save).toHaveBeenCalledTimes(2);
    const finalStep = vi.fn(async () => 'flushed');
    let flushed: unknown = 'waiting';
    void flight.flush(finalStep).then((value) => {
      flushed = value;
    });
    await pass(19_999);
    expect(finalStep).not.toHaveBeenCalled();
    await pass(1);
    expect(flushed).toBe('flushed');
    expect(flight.flushing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a request after the deadline starts a save at once', async () => {
    const { flight, save } = heldFlight();
    flight.request();
    await pass(20_000);
    flight.request();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('a leave store behind a save that never answers is sent at the deadline', async () => {
    const { flight, save } = heldFlight();
    const leaving = draftNamed('leaving');
    flight.request();
    flight.storeOnLeave(save, leaving, 'snap-leaving');
    await pass(19_999);
    expect(save).toHaveBeenCalledTimes(1);
    await pass(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(leaving, 'r1');
  });
});
