// TEST-ONLY. A journal stamped with microtask turns, for characterizing code
// whose behaviour is its timing: which callback runs before which, and how many
// turns of the microtask queue pass between them. The test lets a counted
// number of turns pass between its own steps; every line the doubles write is
// stamped with the turns passed so far, so one more `await` in the code under
// test, or an `async` wrapper around a call, moves a line to another stamp.
// It imports nothing and writes nothing.

/** A promise settled by hand. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

export interface TurnJournal {
  /** Every line so far, as `<turns passed> <text>`. */
  readonly lines: string[];
  /** Write one line, stamped with the turns passed so far. */
  note(text: string): void;
  /** Let exactly `count` turns of the microtask queue pass. */
  turns(count: number): Promise<void>;
}

export function createTurnJournal(): TurnJournal {
  let passed = 0;
  const lines: string[] = [];
  return {
    lines,
    note(text) {
      lines.push(`${passed} ${text}`);
    },
    async turns(count) {
      for (let turn = 0; turn < count; turn += 1) {
        await Promise.resolve();
        passed += 1;
      }
    },
  };
}

/** Every order the given steps can come in (the steps are taken as distinct), the given order first. */
export function ordersOf<T>(steps: readonly T[]): T[][] {
  if (steps.length <= 1) return [[...steps]];
  return steps.flatMap((first, index) =>
    ordersOf([...steps.slice(0, index), ...steps.slice(index + 1)]).map((rest) => [first, ...rest]),
  );
}
