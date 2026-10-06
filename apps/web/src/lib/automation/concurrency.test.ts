import { describe, expect, it } from 'vitest';
import { settleWithConcurrency } from './concurrency';

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every queued microtask (and the pool's refills) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settleWithConcurrency', () => {
  it('returns outcomes in input order, not completion order', async () => {
    const delays = [30, 5, 20, 1, 10];
    const outcomes = await settleWithConcurrency(delays, 2, (delay) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(delay * 2), delay)),
    );
    expect(outcomes).toEqual(
      delays.map((delay) => ({ status: 'fulfilled', value: delay * 2 })),
    );
  });

  it('never has more than the limit in flight, and refills a slot as one settles', async () => {
    const gates = Array.from({ length: 7 }, () => deferred<void>());
    let inFlight = 0;
    let peak = 0;
    const started: number[] = [];
    const run = settleWithConcurrency([0, 1, 2, 3, 4, 5, 6], 3, async (index) => {
      started.push(index);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gates[index].promise;
      inFlight -= 1;
    });

    await flush();
    expect(started).toEqual([0, 1, 2]);
    gates[1].resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    gates.forEach((gate) => gate.resolve());
    await run;
    expect(peak).toBe(3);
    expect(started).toHaveLength(7);
  });

  it('records a rejection for its own item and keeps going', async () => {
    const boom = new Error('org 2 failed');
    const outcomes = await settleWithConcurrency([1, 2, 3, 4], 2, async (item) => {
      if (item === 2) throw boom;
      return item;
    });
    expect(outcomes).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: boom },
      { status: 'fulfilled', value: 3 },
      { status: 'fulfilled', value: 4 },
    ]);
  });

  it('isolates a worker that throws synchronously', async () => {
    const outcomes = await settleWithConcurrency(['a', 'b'], 1, (item) => {
      if (item === 'a') throw new Error('sync');
      return Promise.resolve(item);
    });
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rejected', 'fulfilled']);
  });

  it('settles an empty list without calling the worker', async () => {
    let calls = 0;
    const outcomes = await settleWithConcurrency([], 3, async () => {
      calls += 1;
    });
    expect(outcomes).toEqual([]);
    expect(calls).toBe(0);
  });

  it('refuses a limit that is not a positive integer', async () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      await expect(settleWithConcurrency([1], limit, async (x) => x)).rejects.toThrow(
        RangeError,
      );
    }
  });
});
