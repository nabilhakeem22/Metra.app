import { describe, expect, it } from 'vitest';
import { cellKey, createCellWriteLatch } from './cell-write-latch';

// W5 R5: two saves of the SAME BOQ cell both dispatched, and whichever
// transaction Postgres committed second was the value that survived — not
// necessarily the one the studio typed last. Measured identical on main, so this
// is a pre-existing race the sheet has always had.

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

describe('createCellWriteLatch', () => {
  it('holds the second write of a cell until the first has finished', async () => {
    const log: string[] = [];
    const latch = createCellWriteLatch();
    const first = controllable('first', log);
    const second = controllable('second', log);

    const a = latch.run('line-1|qty', first.write);
    const b = latch.run('line-1|qty', second.write);
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

  it('lets DIFFERENT cells run together', async () => {
    // Two columns of one line do not race — the patch is sparse and the server
    // recomputes from the row as it stands — so serialising them would make a
    // studio tabbing across a row wait for nothing.
    const log: string[] = [];
    const latch = createCellWriteLatch();
    const qty = controllable('qty', log);
    const price = controllable('price', log);

    const a = latch.run('line-1|qty', qty.write);
    const b = latch.run('line-1|unitPrice', price.write);
    await Promise.resolve();

    expect(log).toEqual(['start:qty', 'start:price']);
    qty.release();
    price.release();
    await Promise.all([a, b]);
  });

  it('runs the next write even when the one before it REJECTED', async () => {
    // One failed save must not strand every later edit of that cell. `then(run,
    // run)` is what buys this, and without a test the recovery path is a
    // one-character difference from a permanently dead cell.
    const latch = createCellWriteLatch();
    const failed = latch.run('line-1|qty', () => Promise.reject(new Error('offline')));
    await expect(failed).rejects.toThrow('offline');

    let ran = false;
    await latch.run('line-1|qty', async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('forgets a cell once its queue drains, and remembers one that has not', async () => {
    const latch = createCellWriteLatch();
    await latch.run('line-1|qty', () => Promise.resolve());

    // A fresh write after the queue drained must still be ordered correctly
    // against a write queued behind it — the cleanup is identity-guarded, not
    // unconditional.
    const log: string[] = [];
    const first = controllable('first', log);
    const a = latch.run('line-1|qty', first.write);
    const b = latch.run('line-1|qty', async () => {
      log.push('second');
    });
    await Promise.resolve();
    expect(log).toEqual(['start:first']);
    first.release();
    await Promise.all([a, b]);
    expect(log).toEqual(['start:first', 'end:first', 'second']);
  });
});

describe('cellKey', () => {
  it('is one key per line and column, and is order-free', () => {
    expect(cellKey('line-1', ['qty'])).toBe('line-1|qty');
    expect(cellKey('line-1', ['qty'])).not.toBe(cellKey('line-2', ['qty']));
    expect(cellKey('line-1', ['qty'])).not.toBe(cellKey('line-1', ['unitPrice']));
    // A multi-column save is its own queue, and the two spellings of the same
    // pair must not be two queues.
    expect(cellKey('line-1', ['qty', 'unitPrice'])).toBe(
      cellKey('line-1', ['unitPrice', 'qty']),
    );
  });
});
