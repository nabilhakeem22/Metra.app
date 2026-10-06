// A bounded worker pool. PURE: no server-only, no I/O of its own.

/**
 * Run `worker` over every item with at most `limit` calls in flight, and settle
 * them all.
 *
 * - ORDER: the result at index i is the outcome for `items[i]`, whatever order
 *   the work finished in.
 * - ISOLATION: a rejected (or synchronously throwing) worker becomes a
 *   `rejected` entry for that item and never stops the rest. The only way this
 *   rejects is a `limit` that is not a positive integer.
 * - BOUND: a slot is refilled only when one of its calls settles, so the number
 *   of unsettled `worker` calls never exceeds `limit`.
 */
export async function settleWithConcurrency<Item, Outcome>(
  items: readonly Item[],
  limit: number,
  worker: (item: Item) => Promise<Outcome>,
): Promise<PromiseSettledResult<Outcome>[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`concurrency limit must be a positive integer, got ${limit}`);
  }
  const outcomes = new Array<PromiseSettledResult<Outcome>>(items.length);
  let nextIndex = 0;

  async function drainQueue(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        outcomes[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        outcomes[index] = { status: 'rejected', reason };
      }
    }
  }

  const slots = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: slots }, () => drainQueue()));
  return outcomes;
}
