// Applies roles + RLS policies + trigger functions. Run AFTER migrate.
// Order matters: functions -> immutability -> roles (grants execute on the
// function) -> policies. The list itself lives in rls/manifest.ts.
//
// AND THEN IT READS BACK. The loop's only post-condition used to be that no
// statement threw; nothing said the objects existed. `verify-rls-applied.ts`
// re-reads pg_class / pg_policies / pg_trigger / pg_proc / pg_roles on the SAME
// connection and exits 1 with the offending list, so a file that never ran is a
// loud failure here instead of a symptom somewhere else weeks later.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSql } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import { RLS_APPLY_ORDER } from '../rls/manifest';
import { MIGRATION_LOCK_TIMEOUT, applyRlsTimeouts } from './lock-timeout';
import { declaredCounts, verifyRlsApplied } from './verify-rls-applied';

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const rlsDir = resolve(here, '../rls');
// Order: functions + immutability (create fns) -> roles (grant execute) ->
// policies (reference fns). It is written down in ONE place, rls/manifest.ts,
// which this script and rls/functions-order.test.ts both read.
const files = RLS_APPLY_ORDER;

async function main(): Promise<number> {
  const sql = createSql(MIGRATION_DATABASE_URL(), {
    max: 1,
    prepare: false,
    connection: { lock_timeout: MIGRATION_LOCK_TIMEOUT },
  });
  try {
    // Before the first `sql.unsafe`: each file goes over the simple protocol as
    // ONE implicit transaction, so a single `alter table ... enable row level
    // security` that blocks would hold ACCESS EXCLUSIVE on every table the file
    // already touched until the whole file finished. MORE files therefore means
    // more implicit transactions and strictly SHORTER individual lock windows,
    // not longer ones.
    //
    // WORST CASE, measured from the statement census: policies/10-catalogue.sql
    // takes ACCESS EXCLUSIVE on ELEVEN distinct tables inside one implicit
    // transaction, and `lock_timeout` bounds each lock WAIT, not the file - so
    // with a blocker on every one of them the file can spend 11 x 3 s = 33 s
    // before giving up. Realistically (one long reader on the last table) it is
    // ~3 s of blocked writes on ten tables, then 55P03 and a clean roll-back of
    // that file. The split cut this from 46 tables at once to 11.
    //
    // `statement_timeout` is the OTHER half and is why applyRlsTimeouts, not
    // applyLockTimeout: lock_timeout bounds a lock wait and nothing else, so a
    // half-open Supavisor socket after a successful connect leaves `sql.unsafe`
    // waiting forever with no error. 60 s turns that into 57014.
    await applyRlsTimeouts(sql);
    for (const file of files) {
      const path = resolve(rlsDir, file);
      const content = readFileSync(path, 'utf8');
      console.log(`Applying ${file} ...`);
      await sql.unsafe(content);
    }
    console.log('RLS, roles and functions applied.');

    const problems = await verifyRlsApplied(sql);
    if (problems.length > 0) {
      console.error(
        `apply-rls: the run did NOT land — ${problems.length} declared object(s) ` +
          'are missing from the database:\n' +
          `${problems.join('\n')}\n\n` +
          'Every file above this line reported success, so this is either a file ' +
          'that was applied against a different database than the one just read, ' +
          'or an object whose CREATE was silently a no-op. Re-run apply-rls ' +
          '(every statement under rls/ is idempotent) and, if it repeats, compare ' +
          'rls/manifest.ts against what is on disk.',
      );
      return 1;
    }
    console.log(
      `apply-rls: verified in the catalogues — ${declaredCounts()}, ` +
        'RLS forced on all of them, role metra_app present.',
    );
    return 0;
  } finally {
    await sql.end();
  }
}

// `process.exitCode`, not `process.exit()`: the verification list is the most
// important output this script ever produces and must not be truncated, and the
// `finally` above still has a connection to close.
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: Error) => {
    console.error('apply-rls failed:', err.message);
    process.exitCode = 1;
  });
