// How long the proposal builder waits for the server to answer about its draft:
// a save, or the read that settles a save whose answer was lost. PURE and
// CLIENT-SAFE.
//
// A server action is a bare call with no client-side abort. One that never
// answered held the builder's one save in flight, and with it Send, Back and the
// leave guard, for the life of the tab. Here the WAIT is bounded, not the call:
// past the deadline the caller is told there was no answer and goes on, and
// whatever the abandoned call answers later is dropped. For a draft save that is
// safe: the server locks the proposal and refuses a save made from an older
// revision (lib/proposals/core/draft-save.ts), so a commit that lands late cannot
// overwrite a newer save, and lost-commit.ts recognises it as this tab's own.
//
// NOT the deadline of projects/[id]/cell-write-latch.ts. That one gives a cell's
// queue back and reports through `onDeadline`, while the write it gave up on
// stays alive and still acts on a late answer. Here the call itself is answered,
// once, and a late answer changes nothing.

/**
 * The same 20 s as the app connection's `statement_timeout`
 * (packages/db/src/org-context.ts) and the BOQ sheet's `WRITE_DEADLINE_MS`: a
 * save the database is still running is not abandoned, and one that has not
 * answered by then is treated as lost.
 */
export const DRAFT_ANSWER_DEADLINE_MS = 20_000;

/**
 * Handed to `settle` in place of an answer: the call threw, rejected, answered
 * nothing, or stayed silent past the deadline.
 */
export const NO_ANSWER: unique symbol = Symbol('no answer');

/**
 * Resolves with `settle(answer)` when `call()` answers, or with
 * `settle(NO_ANSWER)` when it throws, rejects, or has not answered after
 * `deadlineMs`. `settle` runs exactly once, in the turn the answer arrives, so
 * this costs no microtask turn more than `await call()` does (the draft save's
 * timing is pinned to the turn). An answer that comes after the deadline is
 * dropped, a rejection included, and no timer is left behind. A `settle` that
 * throws rejects the promise.
 *
 * An answer of null or undefined is no answer too: a server call can resolve
 * with nothing where its type promises a result (the request was answered by
 * something other than the action), and nothing was confirmed by that.
 */
export function settleWithinDeadline<Answer, Settled>(
  call: () => Promise<Answer>,
  deadlineMs: number,
  settle: (answer: Answer | typeof NO_ANSWER) => Settled,
): Promise<Settled> {
  return new Promise<Settled>((resolve, reject) => {
    let waiting = true;
    const finish = (answer: Answer | typeof NO_ANSWER): void => {
      if (!waiting) return;
      waiting = false;
      clearTimeout(deadline);
      try {
        resolve(settle(answer));
      } catch (cause) {
        reject(cause);
      }
    };
    const deadline = setTimeout(() => finish(NO_ANSWER), deadlineMs);
    try {
      // `Promise.resolve` is what `await` does: a promise is taken as it is (no
      // turn more), and a call that answers a plain value is still answered.
      void Promise.resolve(call()).then((answer) => finish(answer ?? NO_ANSWER), () => finish(NO_ANSWER));
    } catch {
      finish(NO_ANSWER);
    }
  });
}
