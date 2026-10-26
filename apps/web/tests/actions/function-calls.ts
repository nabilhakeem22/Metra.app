// How many times functions ran inside one transaction, as Postgres counts
// them (`track_functions`, which only a superuser may turn on, so this runs
// over the BYPASSRLS owner connection). For the reads that must evaluate a
// costly helper once. Not a test file.
import { createDb, type MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';

/** Run `work` in one transaction and answer the calls of each function `signature` (regprocedure text) made in it. */
export async function callsDuring(
  signatures: readonly string[],
  work: (tx: MetraDb) => Promise<unknown>,
): Promise<Record<string, number>> {
  const owner = createDb(process.env.DATABASE_URL as string, { max: 1 });
  try {
    return await owner.db.transaction(async (tx) => {
      await tx.execute(sql`set local track_functions = 'all'`);
      await work(tx as unknown as MetraDb);
      const calls: Record<string, number> = {};
      for (const signature of signatures) {
        const rows = (await tx.execute(
          sql`select coalesce(pg_stat_get_xact_function_calls(${signature}::regprocedure), 0)::int as calls`,
        )) as unknown as Array<{ calls: number }>;
        calls[signature] = rows[0].calls;
      }
      return calls;
    });
  } finally {
    await owner.sql.end();
  }
}
