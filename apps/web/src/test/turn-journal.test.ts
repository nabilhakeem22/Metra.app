import { describe, expect, it } from 'vitest';
import { createTurnJournal, deferred, ordersOf } from './turn-journal';

// The self-test of the turn journal, and the canary of the promise timing of
// the runtime: every literal below is what Node prints, so a runtime that
// schedules an await differently reds here before it reds a characterization.

describe('createTurnJournal', () => {
  it('stamps a line with the turns passed so far', async () => {
    const journal = createTurnJournal();
    journal.note('before');
    await journal.turns(2);
    journal.note('after two');
    await journal.turns(0);
    journal.note('still two');
    await journal.turns(1);
    journal.note('after three');
    expect(journal.lines).toEqual(['0 before', '2 after two', '2 still two', '3 after three']);
  });

  it('stamps each link of a promise chain one turn after the link before it', async () => {
    const journal = createTurnJournal();
    void Promise.resolve()
      .then(() => journal.note('first'))
      .then(() => journal.note('second'))
      .then(() => journal.note('third'));
    await journal.turns(5);
    expect(journal.lines).toEqual(['0 first', '1 second', '2 third']);
  });

  it('sees one more await, an async wrapper, and `return` against `return await`', async () => {
    const stampOf = async (start: () => Promise<unknown>): Promise<string> => {
      const journal = createTurnJournal();
      void start().then(() => journal.note('answered'));
      await journal.turns(8);
      return journal.lines.join();
    };
    const answer = async (): Promise<string> => 'done';
    expect(await stampOf(() => answer())).toBe('0 answered');
    expect(await stampOf(async () => await answer())).toBe('1 answered');
    expect(await stampOf(async () => answer())).toBe('2 answered');
    expect(
      await stampOf(async () => {
        await Promise.resolve();
        return 'done';
      }),
    ).toBe('1 answered');
    expect(
      await stampOf(async () => {
        await Promise.resolve();
        return answer();
      }),
    ).toBe('3 answered');
  });

  it('a deferred settles when told, and not before', async () => {
    const journal = createTurnJournal();
    const gate = deferred<string>();
    const failing = deferred<string>();
    void gate.promise.then((value) => journal.note(`resolved ${value}`));
    void failing.promise.catch((cause: unknown) => journal.note(`rejected ${String(cause)}`));
    await journal.turns(3);
    journal.note('nothing yet');
    gate.resolve('now');
    failing.reject('no');
    await journal.turns(1);
    expect(journal.lines).toEqual(['3 nothing yet', '3 resolved now', '3 rejected no']);
  });
  it('lists every order of its steps, the given order first', () => {
    expect(ordersOf([])).toEqual([[]]);
    expect(ordersOf(['a'])).toEqual([['a']]);
    expect(ordersOf(['a', 'b', 'c']).map((order) => order.join(''))).toEqual(['abc', 'acb', 'bac', 'bca', 'cab', 'cba']);
    expect(ordersOf([1, 2, 3, 4, 5])).toHaveLength(120);
    expect(new Set(ordersOf([1, 2, 3, 4, 5]).map((order) => order.join())).size).toBe(120);
  });
});
