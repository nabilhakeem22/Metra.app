import 'server-only';
import { createDb, type MetraDb, type PostgresJs } from '@metra/db';

// Runtime uses the transaction pooler (:6543) with prepare:false. Fall back to
// DATABASE_URL if the pool URL is absent (e.g. some CI setups).
function runtimeUrl(): string {
  const u = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
  if (!u) throw new Error('DATABASE_POOL_URL or DATABASE_URL must be set');
  return u;
}

let cached: { db: MetraDb; sql: PostgresJs } | null = null;

export function getDb(): MetraDb {
  if (!cached) {
    cached = createDb(runtimeUrl(), { prepare: false, max: 5 });
  }
  return cached.db;
}
