// Rebuilds the indexes the fixture debris bloated. REINDEX ... CONCURRENTLY
// cannot run inside a transaction, so this script issues each statement on a
// plain session; a failed CONCURRENTLY rebuild leaves an invalid index behind,
// which is reported at the end so it can be dropped and retried.
import { createSql } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';

const TABLES = [
  'memberships',
  'stage_templates', 'sections', 'project_stages', 'proposal_lines',
  'document_categories', 'audit_log', 'project_types',
];

async function main() {
  const sql = createSql(MIGRATION_DATABASE_URL(), { max: 1, prepare: false });
  try {
    await sql.unsafe(`set statement_timeout = '10min'`);
    const before = await sql`select pg_total_relation_size('public.memberships')::bigint as b`;
    for (const table of TABLES) {
      await sql.unsafe(`reindex table concurrently public.${table}`);
      await sql.unsafe(`analyze public.${table}`);
      console.log(`reindexed ${table}`);
    }
    const after = await sql`select pg_total_relation_size('public.memberships')::bigint as b`;
    console.log(`memberships total size: ${before[0].b} -> ${after[0].b} bytes`);
    const invalid = await sql`select indexrelid::regclass::text as idx from pg_index where not indisvalid`;
    if (invalid.length > 0) console.log('INVALID indexes left behind (drop concurrently and retry):', invalid);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`reindex-after-purge failed: ${err.message}`);
  process.exit(1);
});
