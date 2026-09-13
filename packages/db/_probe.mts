import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import postgres from 'postgres';
for (const p of ['C:/Users/HP/merta/.env']) if (existsSync(p)) dotenv.config({ path: p });
const sql = postgres(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15 });
const show = (l: string, r: unknown) => { console.log(`\n##### ${l}`); console.log(JSON.stringify(r)); };
try {
  // Probe only: opens a tx, sets the GUC, reads it back, then ROLLS BACK. No data written.
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local session_replication_role = 'replica'`);
      const r = await tx.unsafe(`select current_setting('session_replication_role') v`);
      show('session_replication_role settable', r);
      throw new Error('ROLLBACK_ON_PURPOSE');
    });
  } catch (e: any) { show('tx outcome (expected rollback)', e.message); }
  show('memberships sizes', await sql`
    select pg_size_pretty(pg_relation_size('public.memberships')) heap,
           pg_size_pretty(pg_indexes_size('public.memberships')) idx,
           pg_size_pretty(pg_total_relation_size('public.memberships')) total`);
  show('memberships indexes', await sql`
    select indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) sz
    from pg_stat_user_indexes where schemaname='public' and relname='memberships' order by 1`);
  show('supersedes_event_id nullable', await sql`
    select is_nullable from information_schema.columns
    where table_schema='public' and table_name='engagement_events' and column_name='supersedes_event_id'`);
  show('engagement_events with supersedes set (fixture)', await sql`
    select count(*)::int n from public.engagement_events where supersedes_event_id is not null`);
} finally { await sql.end(); }
