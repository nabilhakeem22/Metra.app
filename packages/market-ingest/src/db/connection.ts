// The CLI's one database connection: DATABASE_URL from the root .env (as
// `db:migrate` reads it), the connection role, one socket. Postgres only.
import { createSql, type PostgresJs } from '@metra/db/client';
import { MIGRATION_DATABASE_URL } from '@metra/db/env';
import type { TransactionSql } from 'postgres';

export type { PostgresJs };

/** The handle inside `sql.begin(...)`: the publish writes run on it. */
export type Transaction = TransactionSql;

export function openDatabase(): PostgresJs {
  return createSql(MIGRATION_DATABASE_URL(), { max: 1 });
}

/** Run `work` on a fresh connection and always close it. */
export async function withDatabase<T>(work: (sql: PostgresJs) => Promise<T>): Promise<T> {
  const sql = openDatabase();
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}
