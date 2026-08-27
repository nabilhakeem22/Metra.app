import 'server-only';
import { after } from 'next/server';
import type { MetraDb, PostgresJs } from '@metra/db';
import { cfExecutionContext, isCloudflareRuntime } from '@/lib/cf/context';
import { createRuntimeConnection } from './client';

/** The one postgres.js instance (+ drizzle handle) shared across a request. */
export interface RequestConn {
  db: MetraDb;
  sql: PostgresJs;
}

// Internal holder adds a once-only close guard so the request-end teardown is
// idempotent: if `after` were ever invoked more than once, the second sql.end()
// must be a no-op rather than a double-close of an already-drained socket.
interface Holder extends RequestConn {
  closed: boolean;
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
  const holder: Holder = { db, sql, closed: false };
  store.set(ctx, holder);

  // Register the once-only teardown for THIS request. `after` (next/server) runs
  // after the response is sent: drop the store entry and close the socket exactly
  // once, deferring the drain via ctx.waitUntil so it neither blocks the response
  // nor lets the read loop bleed into the next request. The `closed` guard makes a
  // repeat invocation a no-op. A mid-request DbDeadlineError never reaches here —
  // teardown is request-scoped, not per-operation — so a deadline can't close a
  // connection its siblings are still using.
  after(async () => {
    store.delete(ctx);
    if (holder.closed) return;
    holder.closed = true;
    ctx.waitUntil(sql.end({ timeout: 5 }));
  });

  return { db, sql };
}
