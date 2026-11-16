// TEST-ONLY. Collects the promise rejections nobody handled, for a test whose
// claim is about exactly that: that a failure is still raised where nothing
// catches it, or that a dropped answer raises nothing. While collecting, the
// runner's own listeners are set aside (it fails the run on an unhandled
// rejection); they are handed back by `stop()`, or when the test finishes
// without reaching it. It writes nothing.
import { onTestFinished } from 'vitest';

// Taken before any test fakes the timers: Node reports an unhandled rejection
// once the microtask queue has drained, so one real turn of the event loop is
// what has to pass before the list is read.
const afterThisTurn = setImmediate;

export interface UnhandledRejections {
  /** The reasons of the rejections left unhandled so far, in order. Stops collecting. */
  stop(): Promise<unknown[]>;
}

/** Call inside a test. */
export function collectUnhandledRejections(): UnhandledRejections {
  const reasons: unknown[] = [];
  const collect = (reason: unknown): void => {
    reasons.push(reason);
  };
  const runnerListeners = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', collect);
  let collecting = true;
  const handBack = (): void => {
    if (!collecting) return;
    collecting = false;
    process.removeAllListeners('unhandledRejection');
    for (const listener of runnerListeners) process.on('unhandledRejection', listener);
  };
  onTestFinished(handBack);
  return {
    async stop() {
      await new Promise<void>((resolve) => afterThisTurn(resolve));
      handBack();
      return reasons;
    },
  };
}
