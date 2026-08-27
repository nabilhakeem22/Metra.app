import 'server-only';
import { createDb, type MetraDb, type PostgresJs } from '@metra/db';
import { cfEnv, isCloudflareRuntime } from '@/lib/cf/context';
import { getRequestConnection } from './request-connection';

// Runtime connection string. On the Cloudflare Workers runtime, Postgres is
// reached through the Hyperdrive binding (pooling + edge cache). Off-platform —
// Node/Vitest tests, `npm run migrate`/`seed`, `next dev` on Node — we keep the
// existing process.env path (transaction pooler :6543) so nothing there changes.
function runtimeUrl(): string {
  if (isCloudflareRuntime()) {
    const connectionString = cfEnv().HYPERDRIVE?.connectionString;
    if (connectionString) return connectionString;
    // On CF the binding is mandatory — fail loud rather than silently reaching
    // for a process.env that the Workers runtime does not populate.
    throw new Error('HYPERDRIVE binding missing on the Cloudflare runtime');
  }
  const u = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_POOL_URL or DATABASE_URL must be set');
  return u;
}

// A postgres.js connection with the runtime-correct options. prepare:false and a
// sensible pool ceiling hold on both paths; SSL is disabled only on the
// Cloudflare/Hyperdrive hop (Hyperdrive terminates TLS to the origin), while
// off-platform keeps the exact host-derived default every script/test relies on.
//
// max:10 tradeoff: on CF this is now the SINGLE instance shared by every
// withRequestDb call in a request (see request-connection.ts). The largest known
// concurrent fan-out is the engagement cockpit's 9-way Promise.all
// (apps/web/src/app/[locale]/(app)/engagements/[id]/page.tsx); max:10 lets that
// run in ONE wave instead of queueing into two. Even at max:10 a single shared
// instance is ~5x fewer sockets than the ~50 that caused the 1102 — which came
// from ~11 SEPARATE instances × max:5, not from a high ceiling on one pool.
export function createRuntimeConnection(): { db: MetraDb; sql: PostgresJs } {
  const ssl = isCloudflareRuntime() ? { ssl: false as const } : {};
  return createDb(runtimeUrl(), { prepare: false, max: 10, ...ssl });
}

// Wall-clock ceiling (ms) for a single withRequestDb call on the Cloudflare
// runtime. The timer is armed when withRequestDb is CALLED, not when its query
// finally reaches the socket — so for a call that queues behind siblings on the
// shared pool this bounds the END-TO-END wait (time from fan-out until settle),
// not per-statement execution. A slow/half-open Hyperdrive origin otherwise hangs
// the request until the platform kills it; this surfaces a clean rejection first.
// Well above a healthy query yet below any platform request budget.
const CF_DB_DEADLINE_MS = 15_000;

/**
 * Thrown when a Cloudflare request-scoped DB operation exceeds
 * CF_DB_DEADLINE_MS. A distinct, coded error so a deadline reads differently
 * from a random failure; mutateInOrg maps it to a generic ActionResult and route
 * reads reject cleanly rather than hanging.
 */
export class DbDeadlineError extends Error {
  constructor() {
    super('db-operation-deadline');
    this.name = 'DbDeadlineError';
  }
}

/**
 * Thrown when a WRITE operation exceeds CF_DB_DEADLINE_MS. Distinct from
 * DbDeadlineError because the outcome is genuinely ambiguous, not a clean
 * failure: Promise.race abandons the losing promise but does NOT cancel it, and
 * the shared request-scoped connection is deliberately never `end()`ed per call
 * (siblings share the socket). So an abandoned `db.transaction()` from a write can
 * still COMMIT at Postgres a moment after this rejects. Callers must therefore
 * treat a write deadline as "may or may not have applied" and NOT blind-retry
 * (which would double-apply); mutateInOrg maps it to the `uncertain` ActionCode.
 * Reads keep DbDeadlineError — a timed-out SELECT commits nothing, so it is
 * retry-safe.
 */
export class DbWriteUncertainError extends Error {
  constructor() {
    super('db-write-uncertain');
    this.name = 'DbWriteUncertainError';
  }
}

// Off-platform (Node/Vitest/migrate/seed/next dev) the DB socket is NOT
// request-scoped, so a single process-lived pool is correct — and stays exactly
// as before. On the Workers runtime this singleton is never populated: a socket
// there is request-scoped, and caching one at module scope is the very bug that
// throws "Cannot perform I/O on behalf of a different request" on a warm isolate.
let cached: { db: MetraDb; sql: PostgresJs } | null = null;

/**
 * The process-lived DB handle. Off-platform ONLY. On the Cloudflare runtime a
 * module singleton would leak a request-scoped socket into later requests, so
 * every CF caller must go through `withRequestDb()` instead — we fail loud here
 * rather than hand back a cross-request socket.
 */
export function getDb(): MetraDb {
  if (isCloudflareRuntime()) {
    throw new Error(
      'getDb() is off-platform only; use withRequestDb() on the Cloudflare runtime',
    );
  }
  if (!cached) {
    cached = createRuntimeConnection();
  }
  return cached.db;
}

/**
 * Run `fn` against a DB connection scoped to exactly the current request.
 *
 * On the Cloudflare Workers runtime a postgres.js socket is request-scoped: it
 * cannot be reused by a later request, and its background read loop must not
 * dangle past the request that opened it. Every withRequestDb call in one request
 * now SHARES a single lazily-created instance (getRequestConnection): it is
 * created on first use and closed exactly once at request end via that module's
 * `after()` teardown. This collapses a cockpit render's ~11 calls from ~11
 * instances (~50 sockets) to one ≤5-socket pool — the fix for the Error 1102
 * connection fan-out. Nothing is retained at module scope on CF (the shared
 * instance lives in a WeakMap keyed by the request's ExecutionContext).
 *
 * Off-platform this is a straight pass-through to the process-lived singleton, so
 * Node/Vitest/migrate/seed/next-dev behaviour is unchanged.
 */
export async function withRequestDb<T>(
  fn: (db: MetraDb) => Promise<T>,
  opts: { write?: boolean } = {},
): Promise<T> {
  if (!isCloudflareRuntime()) {
    return fn(getDb());
  }
  // Reuse the ONE request-scoped instance; no socket is opened or closed here per
  // call. Teardown is request-scoped (getRequestConnection registers it once), so
  // this branch must NOT call sql.end() — doing so would kill siblings still using
  // the shared connection, and a per-operation deadline must reject only its own
  // call, never close the shared socket.
  const { db } = getRequestConnection();
  // Bound the WHOLE operation, not individual statements: the deadline races the
  // entire fn (which owns the RLS-scoped transaction), so isolation/transaction
  // semantics are untouched — on a deadline this call rejects while sibling ops on
  // the shared connection keep resolving. The race abandons but does NOT cancel
  // the losing fn, and this branch must never `end()` the shared socket, so a
  // write's abandoned tx can still COMMIT after we reject. We therefore reject
  // with DbWriteUncertainError for writes (ambiguous — may have applied) and
  // DbDeadlineError for reads (clean — a timed-out SELECT commits nothing).
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(db),
      new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(
          () =>
            reject(
              opts.write ? new DbWriteUncertainError() : new DbDeadlineError(),
            ),
          CF_DB_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}
