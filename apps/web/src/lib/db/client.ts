import 'server-only';
import { createDb, type MetraDb, type PostgresJs } from '@metra/db';
import { cfEnv, isCloudflareRuntime } from '@/lib/cf/context';

// Runtime connection string. On the Cloudflare Workers runtime, Postgres is
// reached through the Hyperdrive binding (pooling + edge cache). Off-platform —
// Node/Vitest tests, `npm run migrate`/`seed`, `next dev` on Node — we keep the
// existing process.env path (transaction pooler :6543) so nothing there changes.
// prepare:false is preserved by getDb() below for both paths.
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

let cached: { db: MetraDb; sql: PostgresJs } | null = null;

export function getDb(): MetraDb {
  if (!cached) {
    // Hyperdrive terminates TLS to the origin, so the worker->Hyperdrive hop
    // must NOT force SSL. Off-platform (Node tests/scripts/next dev) we omit the
    // override and keep the exact host-derived behaviour.
    const ssl = isCloudflareRuntime() ? { ssl: false as const } : {};
    cached = createDb(runtimeUrl(), { prepare: false, max: 5, ...ssl });
  }
  return cached.db;
}
