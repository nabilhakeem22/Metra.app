// The CLI's one database connection, from MARKET_DATABASE_URL and NOTHING
// else: never DATABASE_URL, never the repo's .env. An extracting session runs
// in a shell that has no MARKET_DATABASE_URL, so it cannot reach a database
// even by accident; only the owner's own steps (catalogue, the online check,
// review, publish, withdraw) set it. Postgres only.
import { createDb, createSql, type MetraDb, type PostgresJs } from '@metra/db/client';
import type { TransactionSql } from 'postgres';

export type { PostgresJs };

/** The handle inside `sql.begin(...)`: the publish writes run on it. */
export type Transaction = TransactionSql;

/** Either handle: the history and catalogue reads run on both. */
export type Queryable = PostgresJs | Transaction;

export const DATABASE_URL_VARIABLE = 'MARKET_DATABASE_URL';

function databaseUrl(): string {
  const url = process.env[DATABASE_URL_VARIABLE];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      `${DATABASE_URL_VARIABLE} is not set. This step reads the published market data and is the owner's to run; an extracting session runs only "market:check --offline"`,
    );
  }
  return url;
}

export function openDatabase(): PostgresJs {
  return createSql(databaseUrl(), { max: 1 });
}

/** The same connection with drizzle over it, for the org-scoped (RLS) writes of the seed. */
export async function withDrizzle<T>(work: (db: MetraDb, sql: PostgresJs) => Promise<T>): Promise<T> {
  const { db, sql } = createDb(databaseUrl(), { max: 1 });
  try {
    return await work(db, sql);
  } finally {
    await sql.end();
  }
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
