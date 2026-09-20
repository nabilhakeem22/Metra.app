import { afterEach, describe, expect, it, vi } from 'vitest';
import { WRITE_DEADLINE_MS, createCellWriteLatch, type CellWrite } from './cell-write-latch';

// W5 R5: two saves of the SAME BOQ cell both dispatched, and whichever
// transaction Postgres committed second was the value that survived — not
// necessarily the one the studio typed last. Measured identical on main, so this
// is a pre-existing race the sheet has always had.
//
// Wave 7 then found three things wrong with the fix: the key was the exact
// COLUMN LIST rather than the line, so two writes carrying `qty` under different
// list shapes raced anyway (F1/R7); the queue was N deep, so N edits of one cell
// cost N round trips of sheet-wide `pending` (R4); and there was no deadline at
// all, so a request that never answered held the cell for the life of the tab
// (S6). The cases below are one per finding, plus the measurements.

/** A write that resolves only when told to, and records when it ran. */
function controllable(name: string, log: string[]) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    write: async () => {
      log.push(`start:${name}`);
      await released;
      log.push(`end:${name}`);
    },
  };
}

/** A request with the deadline handler stubbed; most cases never reach it. */
function request(
  lineId: string,
  columns: string[],
  write: () => Promise<void>,
  onDeadline: () => void = () => undefined,
): CellWrite {
  return { lineId, columns, write, onDeadline };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createCellWriteLatch', () => {
  it('holds the second write of a cell until the first has finished', async () => {
    const log: string[] = [];
    const latch = createCellWriteLatch();
    const first = controllable('first', log);
    const second = controllable('second', log);

    const a = latch.run(request('line-1', ['qty'], first.write));
    const b = latch.run(request('line-1', ['qty'], second.write));
    await Promise.resolve();

    // The second has not even STARTED: that is the whole guarantee. Both were
    // dispatched before, and the server decided the order.
    expect(log).toEqual(['start:first']);

    first.release();
    await a;
    await Promise.resolve();
    expect(log).toEqual(['start:first', 'end:first', 'start:second']);

    second.release();
    await b;
    expect(log).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('lets DIFFERENT columns of one line run together', async () => {
    // Two columns of one line do not race — the patch is sparse and the server
    // recomputes from the row as it stands — so serialising them would make a
    // studio tabbing across a row wait for nothing.
    const log: string[] = [];
    const latch = createCellWriteLatch();
    const qty = controllable('qty', log);
    const price = controllable('price', log);

    const a = latch.run(request('line-1', ['qty'], qty.write));
    const b = latch.run(request('line-1', ['unitPrice'], price.write));
    await Promise.resolve();

    expect(log).toEqual(['start:qty', 'start:price']);
    qty.release();
    price.release();
    await Promise.all([a, b]);
  });

  it('SERIALISES two writes that merely OVERLAP in one column (F1/R7)', async () => {
    // The race the old key allowed: `['qty']` and `['qty','unitPrice']` hashed
    // to two queues, so both writes to `qty` were in flight at once — exactly
    // the lost update the latch exists to prevent. Latent then because no call
    // site passed two columns; live the day one does.
    const log: string[] = [];
    const latch = createCellWriteLatch();
    const single = controllable('qty', log);
    const both = controllable('qty+price', log);

    const a = latch.run(request('line-1', ['qty'], single.write));
    const b = latch.run(request('line-1', ['qty', 'unitPrice'], both.write));
    await Promise.resolve();

    expect(log).toEqual(['start:qty']);
    single.release();
    await a;
    await Promise.resolve();
    expect(log).toEqual(['start:qty', 'end:qty', 'start:qty+price']);
    both.release();
    await b;
  });

  it('keeps one line out of another line’s way', async () => {
    const log: string[] = [];
    const latch = createCellWriteLatch();
    const one = controllable('one', log);
    const two = controllable('two', log);

    const a = latch.run(request('line-1', ['qty'], one.write));
    const b = latch.run(request('line-2', ['qty'], two.write));
    await Promise.resolve();

    expect(log).toEqual(['start:one', 'start:two']);
    one.release();
    two.release();
    await Promise.all([a, b]);
  });

  it('gives two Provisional toggles ONE strand, though they name no cell', async () => {
    // `columns: []` is the toggle. Two of them are a lost update on one boolean;
    // they race nothing else.
    const log: string[] = [];
    const latch = createCellWriteLatch();
    const first = controllable('toggle-1', log);
    const second = controllable('toggle-2', log);

    const a = latch.run(request('line-1', [], first.write));
    const b = latch.run(request('line-1', [], second.write));
    await Promise.resolve();
    expect(log).toEqual(['start:toggle-1']);

    first.release();
    await a;
    await Promise.resolve();
    expect(log).toEqual(['start:toggle-1', 'end:toggle-1', 'start:toggle-2']);
    second.release();
    await b;
  });

  it('COALESCES: only the LAST value queued behind a write is sent', async () => {
    const log: string[] = [];
    const latch = createCellWriteLatch();
    const first = controllable('12', log);
    const sent: string[] = [];

    const a = latch.run(request('line-1', ['qty'], first.write));
    const b = latch.run(
      request('line-1', ['qty'], async () => {
        sent.push('15');
      }),
    );
    const c = latch.run(
      request('line-1', ['qty'], async () => {
        sent.push('18');
      }),
    );

    // The superseded write resolves IMMEDIATELY — its caller's `finally` is what
    // unwinds the saving count, and a write that will never be sent is not
    // pending.
    await b;

    first.release();
    await Promise.all([a, c]);
    expect(sent).toEqual(['18']);
    expect(log).toEqual(['start:12', 'end:12']);
  });

  it('runs the next write even when the one before it REJECTED', async () => {
    // One failed save must not strand every later edit of that cell, and without
    // a test the recovery path is one character away from a permanently dead cell.
    const latch = createCellWriteLatch();
    const failed = latch.run(
      request('line-1', ['qty'], () => Promise.reject(new Error('offline'))),
    );
    await expect(failed).resolves.toBeUndefined();

    let ran = false;
    await latch.run(
      request('line-1', ['qty'], async () => {
        ran = true;
      }),
    );
    expect(ran).toBe(true);
  });

  it('forgets a line once its queue drains, and remembers one that has not', async () => {
    const latch = createCellWriteLatch();
    await latch.run(request('line-1', ['qty'], () => Promise.resolve()));

    // A fresh write after the queue drained must still be ordered correctly
    // against a write queued behind it.
    const log: string[] = [];
    const first = controllable('first', log);
    const a = latch.run(request('line-1', ['qty'], first.write));
    const b = latch.run(
      request('line-1', ['qty'], async () => {
        log.push('second');
      }),
    );
    await Promise.resolve();
    expect(log).toEqual(['start:first']);
    first.release();
    await Promise.all([a, b]);
    expect(log).toEqual(['start:first', 'end:first', 'second']);
  });
});

describe('the deadline (S6)', () => {
  it('releases the cell and reports it when a write never answers', async () => {
    vi.useFakeTimers();
    const latch = createCellWriteLatch();
    const abandoned: string[] = [];
    const ran: string[] = [];

    const stuck = latch.run(
      request(
        'line-1',
        ['qty'],
        () => new Promise<void>(() => undefined),
        () => {
          abandoned.push('qty');
        },
      ),
    );
    const queued = latch.run(
      request('line-1', ['qty'], async () => {
        ran.push('second');
      }),
    );

    await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS - 1);
    expect(abandoned).toEqual([]);
    expect(ran).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await stuck;
    await queued;
    // The refusal is reported ONCE, and the cell is usable again: the write that
    // was queued behind the stuck one has now run.
    expect(abandoned).toEqual(['qty']);
    expect(ran).toEqual(['second']);
  });

  it('does not fire for a write that answered in time', async () => {
    vi.useFakeTimers();
    const latch = createCellWriteLatch();
    const abandoned: string[] = [];
    await latch.run(
      request(
        'line-1',
        ['qty'],
        () => Promise.resolve(),
        () => {
          abandoned.push('qty');
        },
      ),
    );
    await vi.advanceTimersByTimeAsync(WRITE_DEADLINE_MS * 2);
    expect(abandoned).toEqual([]);
  });

  it('is the app connection’s statement_timeout, not a number of its own', () => {
    // org-context.ts:48 sets statement_timeout = 20s on the request connection.
    // Past that the transaction is dead at the database, so a response that has
    // not arrived is a lost save rather than a slow one.
    expect(WRITE_DEADLINE_MS).toBe(20_000);
  });
});

describe('how long the sheet stays pending (R4)', () => {
  // `use-boq-writes.ts` has ONE `useTransition` for the whole sheet, and
  // `pending` disables Add Section, Add Line in every section, and every row's
  // Provisional and Delete. Before coalescing it was held for the SUM of the
  // queued writes; the numbers below are the measurement, at a 100 ms server
  // round trip, on fake timers.
  const ROUND_TRIP = 100;

  /** `pending` is true while any dispatched write has not resolved. */
  async function pendingHeldFor(edits: number, columnsOf: () => string[]): Promise<number> {
    const latch = createCellWriteLatch();
    let inFlight = 0;
    let clearedAt = 0;
    const started = Date.now();
    const all: Array<Promise<void>> = [];
    for (let edit = 0; edit < edits; edit += 1) {
      inFlight += 1;
      all.push(
        latch
          .run(
            request(
              'line-1',
              columnsOf(),
              () => new Promise<void>((resolve) => setTimeout(resolve, ROUND_TRIP)),
            ),
          )
          .finally(() => {
            inFlight -= 1;
            if (inFlight === 0) clearedAt = Date.now();
          }),
      );
    }
    await vi.advanceTimersByTimeAsync(ROUND_TRIP * (edits + 2));
    await Promise.all(all);
    return clearedAt - started;
  }

  it('is bounded at TWO round trips however many times one cell is re-typed', async () => {
    vi.useFakeTimers();
    const sameCell: Record<number, number> = {};
    for (const edits of [1, 2, 3, 5, 10]) {
      sameCell[edits] = await pendingHeldFor(edits, () => ['qty']);
    }
    // Measured on this branch. Before coalescing the same harness read
    // 100 / 200 / 300 / 500 / 1000 — linear in N, which is what made ten
    // re-types of one figure disable the whole sheet for a second.
    expect(sameCell).toEqual({ 1: 100, 2: 200, 3: 200, 5: 200, 10: 200 });
  });

  it('is ONE round trip when the writes touch different cells', async () => {
    vi.useFakeTimers();
    const columns = ['itemCode', 'description', 'unit', 'qty', 'unitPrice'];
    let next = 0;
    const held = await pendingHeldFor(5, () => [columns[next++]]);
    expect(held).toBe(ROUND_TRIP);
  });
});
