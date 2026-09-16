import 'server-only';
import type { MetraDb } from '@metra/db';
import type { PgTable } from 'drizzle-orm/pg-core';
import { LINE_INSERT_CHUNK } from './limits';

/**
 * Insert line rows in batches of {@link LINE_INSERT_CHUNK}.
 *
 * Five modules (proposal draft-save, proposal supersede, contract generate,
 * variation save, BOQ import) each carried their own `for (const part of
 * chunk(rows, LINE_INSERT_CHUNK))` loop, and four of them reached into
 * `lib/proposals` for the two symbols to write it. One loop, one home.
 *
 * The batching is not an optimisation, it is a correctness boundary: Postgres
 * refuses a statement carrying more than 65,535 bind parameters, and a full
 * 2,000-line sheet at ~15 columns per row is ~30,000 — half the ceiling on one
 * table and over it on a wider one.
 *
 * Runs inside the caller's transaction, so a failed batch rolls back the ones
 * before it. An empty list is a no-op: no statement is issued at all.
 */
export async function insertLinesInChunks<TTable extends PgTable>(
  tx: MetraDb,
  table: TTable,
  rows: TTable['$inferInsert'][],
): Promise<void> {
  for (let start = 0; start < rows.length; start += LINE_INSERT_CHUNK) {
    await tx.insert(table).values(rows.slice(start, start + LINE_INSERT_CHUNK));
  }
}
