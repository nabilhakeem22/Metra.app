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

const DATABASE_URL_VARIABLE = 'MARKET_DATABASE_URL';

/**
 * How this CLI's sessions read in pg_stat_activity, so a lock holder names
 * itself in the report a blocked publish prints (publish/lock-holders.ts).
 * Sent in the startup packet; a pooler that drops it shows the login's
 * default instead, and the report still prints the session's state and age.
 */
export const CLI_APPLICATION_NAME = 'metra-market-cli';

const CLI_CONNECTION = { max: 1, connection: { application_name: CLI_APPLICATION_NAME } };

/**
 * How long closing the connection may take (seconds) before it is destroyed.
 * Measured: once the backend was terminated under a statement, a bare
 * `sql.end()` never settled, so the command never printed its report.
 */
const END_TIMEOUT_SECONDS = 5;

function databaseUrl(): string {
  const url = process.env[DATABASE_URL_VARIABLE];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      `${DATABASE_URL_VARIABLE} is not set. This step reads the published market data and is the owner's to run; an extracting session runs only "market:check --offline"`,
    );
  }
  return url;
}

function openDatabase(): PostgresJs {
  return createSql(databaseUrl(), CLI_CONNECTION);
}

/** The same connection with drizzle over it, for the org-scoped (RLS) writes of the seed. */
export async function withDrizzle<T>(work: (db: MetraDb, sql: PostgresJs) => Promise<T>): Promise<T> {
  const { db, sql } = createDb(databaseUrl(), CLI_CONNECTION);
  try {
    return await work(db, sql);
  } finally {
    await sql.end({ timeout: END_TIMEOUT_SECONDS });
  }
}

/** Run `work` on a fresh connection and always close it. */
export async function withDatabase<T>(work: (sql: PostgresJs) => Promise<T>): Promise<T> {
  const sql = openDatabase();
  try {
    return await work(sql);
  } finally {
    await sql.end({ timeout: END_TIMEOUT_SECONDS });
  }
}
