'use client';

/**
 * ONE WRITE AT A TIME PER CELL, IN THE ORDER THE STUDIO MADE THEM — AND ONLY THE
 * LAST VALUE THEY TYPED.
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
 * THE KEY IS THE LINE; THE TEST IS COLUMN OVERLAP. The first version keyed on the
 * line plus the exact SORTED COLUMN LIST, which is not the rule its own header
 * stated: `['qty']` and `['qty','unitPrice']` hashed to two different queues, so
 * two writes carrying `qty` ran together and raced (wave 7 F1/R7 — latent only
 * because no call site passes two columns yet). Writes to DIFFERENT columns of one
 * line still run in parallel: the patch is sparse and the server recomputes from
 * the row as it stands, so either order gives the same document, and making a
 * studio tabbing across a row wait would be a cost for nothing. A write that names
 * NO cell — the Provisional toggle, `columns: []` — is its own strand: two toggles
 * of one boolean are a lost update, and they race nothing else.
 *
 * COALESCED, NOT QUEUED N DEEP. The waiting write is a VALUE, not an event: if a
 * third edit of the same cell arrives while the first is in flight, the second is
 * superseded and never sent. Only the last value the studio typed goes to the
 * server, so N edits of one cell cost TWO round trips, not N. This is what makes
 * the sheet-wide `pending` (one `useTransition` for the whole sheet, which
 * disables both Add buttons and every row's Delete and Provisional) stop growing
 * linearly with the number of times someone re-typed one figure. Measured on fake
 * timers at a 100 ms round trip, N = 1/2/3/5/10 edits of ONE cell: before
 * 100/200/300/500/1000 ms, after 100/200/200/200/200 (R4, whose own harness read
 * 105/218/313/512/1029 with real timers and the same shape). Two round trips is
 * the floor while the first request is already on the wire.
 * A SUPERSEDED WRITE'S `run` STILL RESOLVES, immediately: its caller's `finally`
 * is what unwinds the saving count, and a write that will never be sent is a write
 * that is no longer pending.
 *
 * WAITS, NEVER DROPS SILENTLY. The last queued write is CHAINED behind the one in
 * flight rather than discarded: the studio typed it, and a save that silently does
 * not happen is the failure this replaces. The chain continues through a REJECTED
 * predecessor — one failed save must not strand every later edit of that cell.
 *
 * AND IT HAS A DEADLINE. A server action that never settles (dropped connection,
 * black-holed TCP) used to hold the strand, and the sheet-wide `pending` with it,
 * for the life of the tab: `updateBoqLine` is a bare call with no client-side
 * abort, and the server's own `statement_timeout` bounds the DATABASE, not a
 * response that never arrives (wave 7 S6). After WRITE_DEADLINE_MS the latch
 * RELEASES the strand — queued writes proceed — and calls the request's
 * `onDeadline`, which is where the log and the refusal on screen live.
 *
 * KNOWN LIMIT — IT HOLDS BY OVERLAP AND COALESCES BY THE EXACT COLUMN LIST, so
 * two OVERLAPPING but differently-shaped writes can leave in the wrong order
 * (wave 7 L1). `run` decides "am I held?" with `overlaps()`, which is right, and
 * then picks its queue slot by the sorted column list, so a later request with an
 * EARLIER key replaces that entry in place — in front of an entry queued before
 * it. Typed in this order on one line:
 *
 *     1st  ['qty']              qty = 12   (in flight)
 *     2nd  ['qty','unitPrice']  qty = 13   (queued, its own entry)
 *     3rd  ['qty']              qty = 14   (queued behind, its own entry)
 *     4th  ['qty','unitPrice']  qty = 15   (COALESCES onto the 2nd — in front)
 *
 * the send order is 12, then 15, then 14, and the document ends holding 14 — the
 * value the studio replaced. LATENT, for the same reason R7 was: every `saveLine`
 * call site passes at most one column today — `[]` (boq-sheet-row-controls.tsx),
 * `['unit']` (boq-sheet-row-fields.tsx) and `[column]` (boq-write-actions.ts) —
 * so two strands of one line never overlap. THE FIRST TWO-COLUMN CONTROL ANYONE
 * ADDS MAKES IT LIVE AND SILENT. The fix when that day comes is to coalesce by
 * OVERLAP as well: fold the arriving write into the earliest entry it overlaps
 * rather than into the one whose key matches, and keep the queue in arrival
 * order. Not done here because it is a behaviour change with no caller to prove
 * it, and wave 7's brief says so.
 *
 * AND THAT PARAGRAPH IS NOT THE FENCE — `cell-write-latch-call-sites.test.ts` is.
 * It parses every `saveLine(…)` call under `apps/web/src` with the TypeScript AST
 * and reds on the first one that passes two columns, naming this file and the fix
 * above in the failure. A comment does not survive the engineer who did not read
 * it; wave 8 item 3 exists because wave 7 shipped only the comment.
 */

/**
 * How long the latch waits for one write before giving the cell back.
 *
 * It matches the app connection's `statement_timeout` (`org-context.ts:48`, 20 s):
 * past that point the transaction the request opened is dead at the database, so a
 * response that has not arrived is not a slow save, it is a lost one. Longer would
 * hold the sheet's controls over a write that cannot land; shorter would abandon a
 * save the database is still legitimately running.
 */
export const WRITE_DEADLINE_MS = 20_000;

export interface CellWrite {
  /** The row being saved. */
  lineId: string;
  /** The cells this write carries. Empty means "no cell" — its own strand. */
  columns: readonly string[];
  /** The request itself. Never called for a write that was superseded. */
  write: () => Promise<void>;
  /** Called instead, once, if the write is still unsettled at the deadline. */
  onDeadline: () => void;
}

export interface CellWriteLatch {
  /**
   * Run `request` once every write already in flight or queued for the same
   * columns of that line has settled — unless a later write to the SAME columns
   * supersedes it first, in which case it is never sent and this resolves.
   */
  run(request: CellWrite): Promise<void>;
}

/** The strand a write belongs to: its columns, order-free. */
function strandKey(columns: readonly string[]): string {
  return [...columns].sort().join(',');
}

/**
 * Do two writes race? Only if they touch a column in common — or if both name no
 * column at all, which is the Provisional toggle's strand.
 */
function overlaps(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || b.size === 0) return a.size === b.size;
  for (const column of a) if (b.has(column)) return true;
  return false;
}

interface InFlight {
  columns: ReadonlySet<string>;
}

interface Queued {
  key: string;
  columns: ReadonlySet<string>;
  /** The LATEST request for these columns. A new one replaces it in place. */
  request: CellWrite;
  /** Callers waiting on this entry, resolved when the write it holds settles. */
  waiting: Array<() => void>;
}

interface LineState {
  inFlight: Set<InFlight>;
  queue: Queued[];
}

export function createCellWriteLatch(): CellWriteLatch {
  const lines = new Map<string, LineState>();

  function stateOf(lineId: string): LineState {
    const existing = lines.get(lineId);
    if (existing) return existing;
    const created: LineState = { inFlight: new Set(), queue: [] };
    lines.set(lineId, created);
    return created;
  }

  function forget(lineId: string, state: LineState): void {
    // Drop the entry once the line is idle, so an open sheet holds nothing.
    if (state.inFlight.size === 0 && state.queue.length === 0 && lines.get(lineId) === state) {
      lines.delete(lineId);
    }
  }

  function start(request: CellWrite, columns: ReadonlySet<string>): Promise<void> {
    const state = stateOf(request.lineId);
    const entry: InFlight = { columns };
    state.inFlight.add(entry);
    return new Promise<void>((resolve) => {
      let settled = false;
      const release = (timedOut: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        state.inFlight.delete(entry);
        drain(request.lineId, state);
        if (timedOut) request.onDeadline();
        forget(request.lineId, state);
        resolve();
      };
      const deadline = setTimeout(() => {
        release(true);
      }, WRITE_DEADLINE_MS);
      void request.write().then(
        () => {
          release(false);
        },
        () => {
          // A rejected save must not strand every later edit of that cell; the
          // caller owns what a failure LOOKS like.
          release(false);
        },
      );
    });
  }

  /** Start every queued write nothing is holding back any more. */
  function drain(lineId: string, state: LineState): void {
    for (let i = 0; i < state.queue.length; ) {
      const queued = state.queue[i];
      const held =
        [...state.inFlight].some((flight) => overlaps(queued.columns, flight.columns)) ||
        state.queue.slice(0, i).some((earlier) => overlaps(queued.columns, earlier.columns));
      if (held) {
        i += 1;
        continue;
      }
      state.queue.splice(i, 1);
      const waiting = queued.waiting;
      void start(queued.request, queued.columns).then(() => {
        for (const resolve of waiting) resolve();
      });
    }
  }

  return {
    run(request) {
      const state = stateOf(request.lineId);
      const columns = new Set(request.columns);
      const held =
        [...state.inFlight].some((flight) => overlaps(columns, flight.columns)) ||
        state.queue.some((queued) => overlaps(columns, queued.columns));
      if (!held) return start(request, columns);

      const key = strandKey(request.columns);
      const queued = state.queue.find((entry) => entry.key === key);
      if (!queued) {
        return new Promise<void>((resolve) => {
          state.queue.push({ key, columns, request, waiting: [resolve] });
        });
      }

      // COALESCE: this request replaces the one waiting for the same cells, and
      // everyone waiting on THAT one stops waiting now — their value is carried
      // by this one, and their write will never be sent.
      const superseded = queued.waiting.splice(0, queued.waiting.length);
      queued.request = request;
      const promise = new Promise<void>((resolve) => {
        queued.waiting.push(resolve);
      });
      for (const resolve of superseded) resolve();
      return promise;
    },
  };
}
