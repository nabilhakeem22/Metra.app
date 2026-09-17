'use client';

/**
 * ONE WRITE AT A TIME PER CELL, IN THE ORDER THE STUDIO MADE THEM.
 *
 * THE DEFECT (W5 R5, measured identical on main). The BOQ sheet saves a line on
 * BLUR, and nothing stopped two saves of the SAME cell being in flight together:
 * type `12`, tab away, tab back, type `15`, tab away — two requests, two server
 * transactions, and whichever one Postgres commits second is the value that
 * survives. That is not necessarily `15`. The studio is shown `15` (the local
 * edit stays until the revalidated record replaces it) and the document may hold
 * `12`, with nothing anywhere saying which won.
 *
 * WHY NOT A VERSION PRECONDITION. The server already re-reads the row inside the
 * transaction (`boqs/edit/line-write.ts` loads qty/price/cost/discount there), so
 * a stale tab cannot revive a figure someone ELSE changed. What it cannot do is
 * order two writes from the SAME tab, because both are correct when they arrive.
 * Ordering is a client-side property and belongs here.
 *
 * WHY PER CELL AND NOT PER LINE. Two writes to DIFFERENT columns of one line do
 * not race: the patch is sparse and the server recomputes from the row as it
 * stands, so either order gives the same document. Serialising them anyway would
 * make a studio tabbing across a row wait for no reason. Two writes to the SAME
 * column are the only pair with a lost update in it.
 *
 * WAITS, NEVER DROPS. The second write is CHAINED behind the first rather than
 * discarded: the studio typed both, and a save that silently does not happen is
 * the failure this replaces, not an improvement on it. The chain continues
 * through a REJECTED predecessor (`then(run, run)`) — one failed save must not
 * strand every later edit of that cell.
 */
export interface CellWriteLatch {
  /** Run `write` after any write already queued for `cell` has settled. */
  run(cell: string, write: () => Promise<void>): Promise<void>;
}

/** The latch key: one line's one column. Sorted, so the key is order-free. */
export function cellKey(lineId: string, columns: readonly string[]): string {
  return `${lineId}|${[...columns].sort().join(',')}`;
}

export function createCellWriteLatch(): CellWriteLatch {
  const queued = new Map<string, Promise<void>>();
  return {
    run(cell, write) {
      const previous = queued.get(cell) ?? Promise.resolve();
      const next = previous.then(write, write);
      queued.set(cell, next);
      // Drop the entry once the tail settles, so an idle sheet holds nothing.
      // Guarded on identity: a write queued in the meantime is the new tail and
      // must not be forgotten.
      void next.then(
        () => {
          if (queued.get(cell) === next) queued.delete(cell);
        },
        () => {
          if (queued.get(cell) === next) queued.delete(cell);
        },
      );
      return next;
    },
  };
}
