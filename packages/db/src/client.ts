import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export { schema };

function needsSsl(url: string): boolean {
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

export interface CreateSqlOptions {
  /** postgres.js prepared statements. MUST be false on the :6543 transaction pooler. */
  prepare?: boolean;
  max?: number;
  /**
   * TLS override. Leave undefined to keep the host-derived default (`require`
   * off-localhost, `false` on localhost) — every existing caller (migrate,
   * seed, apply-rls, tests) relies on that and MUST stay unchanged. Set `false`
   * only on the Cloudflare/Hyperdrive path: Hyperdrive terminates TLS to the
   * origin, so the worker->Hyperdrive hop must not force SSL.
   */
  ssl?: boolean | 'require';
}

/** Raw postgres.js client. */
export function createSql(url: string, opts: CreateSqlOptions = {}) {
  return postgres(url, {
    max: opts.max ?? 10,
    prepare: opts.prepare ?? false,
    // Nullish-coalesce so an explicit `ssl: false` is honoured; only undefined
    // falls through to the host-derived default.
    ssl: opts.ssl ?? (needsSsl(url) ? 'require' : false),
  });
}

export type PostgresJs = ReturnType<typeof createSql>;
export type MetraDb = ReturnType<typeof drizzle<typeof schema>>;

/** Drizzle db + underlying sql handle. Caller owns closing `sql`. */
export function createDb(url: string, opts: CreateSqlOptions = {}) {
  const sql = createSql(url, opts);
  const db = drizzle(sql, { schema });
  return { db, sql };
}
