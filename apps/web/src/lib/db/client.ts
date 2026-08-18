import 'server-only';
import { createDb, type MetraDb, type PostgresJs } from '@metra/db';
import { cfEnv, cfExecutionContext, isCloudflareRuntime } from '@/lib/cf/context';

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
function createRuntimeConnection(): { db: MetraDb; sql: PostgresJs } {
  const ssl = isCloudflareRuntime() ? { ssl: false as const } : {};
  return createDb(runtimeUrl(), { prepare: false, max: 5, ...ssl });
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
 * dangle past the request that opened it. So a fresh connection is opened inside
 * this request, handed to `fn`, and closed once `fn` settles via
 * `ctx.waitUntil(sql.end())`. end() runs only AFTER the queries — postgres.js
 * rejects any query issued after end() — and `waitUntil` drains the close past
 * the response without blocking it or letting the read loop bleed into the next
 * request. Nothing is retained at module scope on CF.
 *
 * Off-platform this is a straight pass-through to the process-lived singleton, so
 * Node/Vitest/migrate/seed/next-dev behaviour is unchanged.
 */
export async function withRequestDb<T>(
  fn: (db: MetraDb) => Promise<T>,
): Promise<T> {
  if (!isCloudflareRuntime()) {
    return fn(getDb());
  }
  const { db, sql } = createRuntimeConnection();
  try {
    return await fn(db);
  } finally {
    // Close AFTER the queries and defer the drain past the response. The timeout
    // bounds the drain so a half-open socket can't hang the waitUntil budget.
    cfExecutionContext().waitUntil(sql.end({ timeout: 5 }));
  }
}
