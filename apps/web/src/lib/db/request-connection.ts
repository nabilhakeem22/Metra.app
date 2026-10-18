import 'server-only';
import { after } from 'next/server';
import type { MetraDb, PostgresJs } from '@metra/db';
import { cfExecutionContext, isCloudflareRuntime } from '@/lib/cf/context';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { settledWithin } from '@/lib/async/settled-within';
import { createRuntimeConnection } from './client';

/** The one postgres.js instance (+ drizzle handle) shared across a request. */
export interface RequestConn {
  db: MetraDb;
  sql: PostgresJs;
}

// Internal holder adds a once-only close guard so the request-end teardown is
// idempotent: if `after` were ever invoked more than once, the second sql.end()
// must be a no-op rather than a double-close of an already-drained socket.
// `held` is the work started in the request that may outlive the response
// (holdRequestConnectionUntil): the teardown waits for it before it ends.
interface Holder extends RequestConn {
  closed: boolean;
  held: Set<Promise<void>>;
}

// Keyed by the current request's ExecutionContext object — stable within a
// request, distinct across requests. A WeakMap (not a plain module var) is the
// crux of not leaking a request-scoped socket at module scope: an entry is only
// reachable while that request's ctx is alive, teardown deletes it explicitly,
// and keying on ctx guarantees a warm isolate can never hand one request's
// connection to another (which would throw "Cannot perform I/O on behalf of a
// different request").
const store = new WeakMap<ReturnType<typeof cfExecutionContext>, Holder>();

/**
 * The ONE DB connection shared by every `withRequestDb` call in the current
 * Cloudflare request. Created lazily on first use with `max:5`, reused on every
 * later call, and torn down exactly once at request end via `after()`. This is
 * what collapses a cockpit render's ~11 `withRequestDb` calls from ~11 instances
 * (~50 sockets) down to a single ≤5-socket pool — the fix for the Error 1102
 * connection fan-out.
 *
 * Cloudflare runtime ONLY: off-platform the process-lived singleton (getDb) is
 * correct and there is no request ctx to key on, so we fail loud here.
 */
export function getRequestConnection(): RequestConn {
  if (!isCloudflareRuntime()) {
    throw new Error(
      'getRequestConnection() is Cloudflare-runtime only; use getDb() off-platform',
    );
  }
  const ctx = cfExecutionContext();
  const existing = store.get(ctx);
  if (existing) return { db: existing.db, sql: existing.sql };

  const { db, sql } = createRuntimeConnection();
  const holder: Holder = { db, sql, closed: false, held: new Set() };
  store.set(ctx, holder);

  // Register the once-only teardown for THIS request. `after` (next/server) runs
  // after the response is sent: once the held work has settled
  // (holdRequestConnectionUntil), drop the store entry and close the socket exactly
  // once, deferring the drain via ctx.waitUntil so it neither blocks the response
  // nor lets the read loop bleed into the next request. The `closed` guard makes a
  // repeat invocation a no-op. A mid-request DbDeadlineError never reaches here —
  // teardown is request-scoped, not per-operation — so a deadline can't close a
  // connection its siblings are still using.
  //
  // BEST-EFFORT: `after()` must NEVER take down the request. If it is unavailable
  // or throws in a given runtime context (some OpenNext/Workers render scopes lack
  // a wired after-context), we swallow it and fall back to the platform reclaiming
  // the request-scoped socket when the request's IoContext is destroyed at request
  // end. That degrades a graceful drain to a hard reclaim — NOT a leak (peak
  // sockets stay <= max for the request) and NOT a 1102 regression — while keeping
  // the render alive. The graceful drain still runs wherever after() IS wired.
  try {
    after(async () => {
      if (holder.closed) return;
      holder.closed = true;
      ctx.waitUntil(endWhenIdle(holder, () => store.delete(ctx)));
    });
  } catch (err) {
    console.warn(
      'getRequestConnection: after() teardown unavailable',
      loggableFailure(err),
    );
  }

  return { db, sql };
}

/**
 * The most the teardown waits for held work before it ends the connection
 * anyway. A held work item that never settles must not keep a connection (one
 * of the session pooler's 15) open until the platform's waitUntil limit; the
 * one caller today holds a close bounded at 4 s (HANDOVER_CLOSE_BUDGET_MS).
 */
export const HELD_WORK_CAP_MS = 12_000;

/** Every piece of held work settled, including any held while waiting. */
async function heldWorkSettled(holder: Holder): Promise<void> {
  while (holder.held.size > 0) await Promise.all([...holder.held]);
}

/**
 * The teardown proper: wait for the held work, at most HELD_WORK_CAP_MS,
 * then forget the connection and end it (a statement still running then has
 * 5 s to finish). Until then a later `withRequestDb` in that work still gets
 * this same connection. Past the cap: one redacted line, a count and the cap.
 */
async function endWhenIdle(holder: Holder, forget: () => void): Promise<void> {
  if (holder.held.size > 0 && !(await settledWithin(heldWorkSettled(holder), HELD_WORK_CAP_MS))) {
    console.error('request connection ended with held work still running:', { heldWork: holder.held.size, capMs: HELD_WORK_CAP_MS });
  }
  forget();
  await holder.sql.end({ timeout: 5 });
}

/**
 * Keep the request's connection open until `work` settles: for DB work started
 * in the request that may run on after the response (`after(() => work)`).
 *
 * WHY: the teardown above runs in `after()`, and Next starts every `after()`
 * callback at once, so without this it ends the socket while that work is
 * still going: postgres.js lets a transaction already open finish, but every
 * statement or transaction the work starts afterwards fails with
 * CONNECTION_ENDED (and one still open 5 s later is cut). Call it during the
 * request. Never throws; a rejection of `work` is the caller's to handle.
 * Off-platform there is no request connection to hold.
 */
export function holdRequestConnectionUntil(work: Promise<unknown>): void {
  if (!isCloudflareRuntime()) return;
  getRequestConnection();
  const holder = store.get(cfExecutionContext());
  if (!holder || holder.closed) return;
  const settled = work.then(
    () => undefined,
    () => undefined,
  );
  holder.held.add(settled);
  void settled.then(() => holder.held.delete(settled));
}
