import 'server-only';
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

/**
 * Allocate the next per-org integer sequence for a document table (proposals,
 * contracts, variation_orders). MUST run inside a withOrgContext transaction so
 * the max() read is RLS-scoped to the current org.
 *
 * A per-org `pg_advisory_xact_lock` (keyed by `<orgId>:<scope>`) serializes
 * concurrent allocators, so two racing creates can never collide on `number`.
 * The lock is transaction-scoped: it releases automatically on commit/rollback.
 *
 * `table`/`column` are trusted code constants (never user input); they are
 * emitted as raw identifiers.
 */
export async function allocateNumber(
  tx: MetraDb,
  orgId: string,
  scope: string,
  table: string,
  column: string,
): Promise<number> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`${orgId}:${scope}`}))`,
  );
  const rows = (await tx.execute(
    sql.raw(
      `select coalesce(max("${column}"), 0) + 1 as next from public."${table}"`,
    ),
  )) as unknown as Array<{ next: number }>;
  return Number(rows[0]?.next ?? 1);
}
