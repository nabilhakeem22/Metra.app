// One-off cleanup for the fixture debris that apps/web/tests/actions/fixture.ts
// leaves behind when a run dies before teardown(). Identity-based, not
// activity-based: an org is doomed only if it AND its account carry a fixture
// name, the account is unshared, no member of it touches a real org or
// auth.users, and it is old enough that no run can still be holding it.
// Default is --dry-run. --execute requires the --expect-real-orgs=<n> the
// dry-run printed, so a DB that changed underneath you refuses the purge.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSql, type PostgresJs } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import { MIGRATION_LOCK_TIMEOUT, applyLockTimeout } from './lock-timeout';
import {
  FIXTURE_NAME,
  MIN_AGE,
  countFixtureOrgs,
  countRealOrgs,
  selectDoomedOrgs,
  type DoomedOrg,
  type Executor,
} from './purge-fixture-orgs-select';
import {
  DELETE_ORDER,
  REMAINING_TABLES,
  TRIGGER_GUARDED_TABLES,
  assertDeleteOrderCoversEveryOrgScopedTable,
  assertNoOrphanOrgRows,
} from './purge-fixture-orgs-tables';

const ORGS_PER_TRANSACTION = 50;

async function reportPerTableCounts(sql: Executor, orgIds: string[]) {
  for (const table of DELETE_ORDER) {
    const rows = (await sql.unsafe(
      `select count(*)::int as n from public.${table} where org_id = any($1::uuid[])`,
      [orgIds],
    )) as unknown as Array<{ n: number }>;
    if (rows[0].n > 0) console.log(`  ${table.padEnd(30)} ${rows[0].n}`);
  }
}

function writeManifest(doomed: DoomedOrg[]): string {
  const path = resolve(process.cwd(), `purge-fixture-orgs-${Date.now()}.json`);
  const body = { fixtureName: FIXTURE_NAME, minAge: MIN_AGE, count: doomed.length, doomed };
  writeFileSync(path, JSON.stringify(body, null, 2));
  return path;
}

async function deleteOrgScopedRows(tx: Executor, orgIds: string[]) {
  // Self-referential RESTRICT FK (supersedes_event_id) is checked per row, so a
  // bulk delete would trip over it. Nullable; nulling it first is the cheap fix.
  await tx.unsafe(
    `update public.engagement_events set supersedes_event_id = null
     where org_id = any($1::uuid[]) and supersedes_event_id is not null`, [orgIds]);
  // organizations.logo_file_id -> files is NO ACTION and sits outside
  // DELETE_ORDER, but the org's files are deleted before the org itself: a
  // doomed org that ever uploaded a logo would raise 23503 and roll back the
  // whole 50-org chunk. Nullable, so null it first for the same cheap reason.
  await tx.unsafe(
    `update public.organizations set logo_file_id = null
     where id = any($1::uuid[]) and logo_file_id is not null`, [orgIds]);
  await tx.unsafe(`set local session_replication_role = 'replica'`);
  for (const t of TRIGGER_GUARDED_TABLES) {
    await tx.unsafe(`delete from public.${t} where org_id = any($1::uuid[])`, [orgIds]);
  }
  await tx.unsafe(`set local session_replication_role = 'origin'`);
  for (const t of REMAINING_TABLES) {
    await tx.unsafe(`delete from public.${t} where org_id = any($1::uuid[])`, [orgIds]);
  }
}

async function purgeChunk(sql: PostgresJs, chunk: DoomedOrg[], expectedRealOrgs: number) {
  await sql.begin(async (tx) => {
    const seen = await countRealOrgs(tx as unknown as Executor);
    if (seen !== expectedRealOrgs) {
      throw new Error(`real-org count moved ${expectedRealOrgs} -> ${seen}; aborting purge`);
    }
    await deleteOrgScopedRows(tx as unknown as Executor, chunk.map((d) => d.orgId));
    // accounts have no org_id and the FK is RESTRICT, so they go after the org.
    await tx.unsafe(`delete from public.organizations where id = any($1::uuid[])`,
      [chunk.map((d) => d.orgId)]);
    await tx.unsafe(`delete from public.accounts where id = any($1::uuid[])`,
      [chunk.map((d) => d.accountId)]);
  });
}

/** What the purge WOULD do. Always printed, execute or not. */
async function reportPlan(
  sql: PostgresJs,
  realOrgs: number,
  doomed: DoomedOrg[],
): Promise<void> {
  const fixture = await countFixtureOrgs(sql);
  console.log(
    `real orgs ${realOrgs} | fixture orgs ${fixture} | doomed ${doomed.length} | ` +
      `skipped ${fixture - doomed.length} (too recent or failed an exclusion)`,
  );
  console.log('rows that would be deleted:');
  await reportPerTableCounts(sql, doomed.map((d) => d.orgId));
}

async function main() {
  const argv = process.argv.slice(2);
  const execute = argv.includes('--execute');
  const expected = Number(argv.find((a) => a.startsWith('--expect-real-orgs='))?.slice(19));
  const sql = createSql(MIGRATION_DATABASE_URL(), {
    max: 1, prepare: false, connection: { lock_timeout: MIGRATION_LOCK_TIMEOUT },
  });
  try {
    await applyLockTimeout(sql);
    await assertDeleteOrderCoversEveryOrgScopedTable(sql);
    const realOrgs = await countRealOrgs(sql);
    const doomed = await selectDoomedOrgs(sql);
    await reportPlan(sql, realOrgs, doomed);
    if (!execute) {
      console.log(`\nDRY RUN: nothing written. To execute:\n` +
        `  npx tsx src/scripts/purge-fixture-orgs.ts --execute --expect-real-orgs=${realOrgs}`);
      return;
    }
    if (expected !== realOrgs) {
      throw new Error(`--expect-real-orgs=${expected} but the DB reports ${realOrgs}; refusing.`);
    }
    console.log(`manifest written: ${writeManifest(doomed)}`);
    for (let i = 0; i < doomed.length; i += ORGS_PER_TRANSACTION) {
      const chunk = doomed.slice(i, i + ORGS_PER_TRANSACTION);
      await purgeChunk(sql, chunk, realOrgs);
      console.log(`purged ${i + chunk.length}/${doomed.length} orgs`);
    }
    // The post-condition, after the work and before anyone calls this done: the
    // replica-mode window suspends foreign keys as well as triggers, so a table
    // deleted in the wrong order leaves orphans and every count above still reads
    // as success. Throws, loudly, with the table and the row count.
    await assertNoOrphanOrgRows(sql);
    console.log('Purge complete. Run db:reindex-after-purge next.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(`purge-fixture-orgs failed: ${err.message}`);
  process.exit(1);
});
