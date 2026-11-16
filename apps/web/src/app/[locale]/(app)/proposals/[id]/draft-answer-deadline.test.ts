import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurnJournal, deferred } from '@/test/turn-journal';
import { collectUnhandledRejections } from '@/test/unhandled-rejections';
import { DRAFT_ANSWER_DEADLINE_MS, NO_ANSWER, settleWithinDeadline } from './draft-answer-deadline';

const told = (answer: string | typeof NO_ANSWER): string => (answer === NO_ANSWER ? 'no answer' : `answered ${answer}`);

/** One call under a 1,000 ms deadline, answered by hand; `outcome()` is what the caller was told so far. */
function waitedFor() {
  const answer = deferred<string>();
  const settle = vi.fn(told);
  let outcome = 'waiting';
  void settleWithinDeadline(() => answer.promise, 1_000, settle).then((settled) => {
    outcome = settled;
  });
  return { answer, settle, outcome: () => outcome };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('settleWithinDeadline', () => {
  it('the builder waits 20 seconds for an answer about its draft', () => {
    expect(DRAFT_ANSWER_DEADLINE_MS).toBe(20_000);
  });

  it('an answer in time is handed to settle once, and no timer is left', async () => {
    const call = waitedFor();
    call.answer.resolve('ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(call.outcome()).toBe('answered ok');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(call.settle).toHaveBeenCalledTimes(1);
    expect(call.settle).toHaveBeenCalledWith('ok');
  });

  it('a rejection is no answer, at once, and is not left unhandled', async () => {
    const unhandled = collectUnhandledRejections();
    const call = waitedFor();
    call.answer.reject(new Error('offline'));
    await vi.advanceTimersByTimeAsync(0);
    expect(call.outcome()).toBe('no answer');
    expect(call.settle).toHaveBeenCalledWith(NO_ANSWER);
    expect(vi.getTimerCount()).toBe(0);
    expect(await unhandled.stop()).toEqual([]);
  });

  it('a call that throws is no answer, and leaves no timer', async () => {
    const settled = settleWithinDeadline((): Promise<string> => {
      throw new Error('threw before sending');
    }, 1_000, told);
    expect(vi.getTimerCount()).toBe(0);
    await expect(settled).resolves.toBe('no answer');
  });

  it('one millisecond before the deadline the call is still waited for; at the deadline it is no answer', async () => {
    const call = waitedFor();
    await vi.advanceTimersByTimeAsync(999);
    expect(call.outcome()).toBe('waiting');
    expect(call.settle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(call.outcome()).toBe('no answer');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an answer one millisecond before the deadline is the answer', async () => {
    const call = waitedFor();
    await vi.advanceTimersByTimeAsync(999);
    call.answer.resolve('just in time');
    await vi.advanceTimersByTimeAsync(1);
    expect(call.outcome()).toBe('answered just in time');
    expect(call.settle).toHaveBeenCalledTimes(1);
  });

  it('an answer after the deadline is dropped: settle is not called again', async () => {
    const call = waitedFor();
    await vi.advanceTimersByTimeAsync(1_000);
    call.answer.resolve('late');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call.outcome()).toBe('no answer');
    expect(call.settle).toHaveBeenCalledTimes(1);
  });

  it('a rejection after the deadline is dropped, and is not left unhandled', async () => {
    const unhandled = collectUnhandledRejections();
    const call = waitedFor();
    await vi.advanceTimersByTimeAsync(1_000);
    call.answer.reject(new Error('late'));
    await vi.advanceTimersByTimeAsync(0);
    expect(call.settle).toHaveBeenCalledTimes(1);
    expect(await unhandled.stop()).toEqual([]);
  });

  it('a settle that throws rejects the promise, for an answer and at the deadline, and leaves no timer', async () => {
    const refuse = (): string => {
      throw new Error('settle threw');
    };
    await expect(settleWithinDeadline(async () => 'ok', 1_000, refuse)).rejects.toThrow('settle threw');
    expect(vi.getTimerCount()).toBe(0);
    const atDeadline = settleWithinDeadline(() => deferred<string>().promise, 1_000, refuse);
    const rejected = expect(atDeadline).rejects.toThrow('settle threw');
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  // The draft save's journals are stamped by the turn (draft-save-flight.characterization.test.ts),
  // and they were recorded when the save was a bare `await save()` in a try.
  it('costs no microtask turn more than a bare await of the call: answered, rejected, thrown', async () => {
    const bare = async (call: () => Promise<string>): Promise<string> => {
      try {
        return told(await call());
      } catch {
        return told(NO_ANSWER);
      }
    };
    const within = (call: () => Promise<string>): Promise<string> => settleWithinDeadline(call, 1_000, told);
    const stamps: Record<string, string[]> = {};
    for (const [name, wait] of [['bare', bare], ['within', within]] as const) {
      const journal = createTurnJournal();
      const answered = deferred<string>();
      const rejected = deferred<string>();
      void wait(() => answered.promise).then((outcome) => journal.note(outcome));
      void wait(() => rejected.promise).then((outcome) => journal.note(outcome));
      void wait(() => {
        throw new Error('threw');
      }).then((outcome) => journal.note(`thrown: ${outcome}`));
      await journal.turns(2);
      answered.resolve('ok');
      rejected.reject(new Error('offline'));
      await journal.turns(4);
      stamps[name] = journal.lines;
    }
    expect(stamps.within).toEqual(['0 thrown: no answer', '3 answered ok', '3 no answer']);
    expect(stamps.within).toEqual(stamps.bare);
  });
});
