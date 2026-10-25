import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withoutSqlComments } from './rls-catalogue';

// Migration 0064 (site diary DB step S), read as text: the two properties of
// the S2 fix round that only the migration can hold, pinned so an edit cannot
// quietly undo them. The rehearsal in docs/DEPLOY.md measures them live.
//
//   * ALL-OR-NONE LOCKS (S2 reliability R2). The four locks on existing tables
//     are taken as ONE attempt of `LOCK TABLE ... NOWAIT` in a subtransaction,
//     retried with a short sleep within one 3 s budget, so the migration never
//     WAITS on a table while it holds another, which is what deadlocked it with
//     the contracts list (40P01).
//   * CLOSED FROM BIRTH (S2 security S5). RLS is enabled and forced on the
//     seven new tables in the migration itself, so an apply-rls that stops
//     between roles.sql (the grants) and policies/70-site.sql (the policies)
//     leaves them denying everything, never open.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const sql = withoutSqlComments(readFileSync(resolve(here, '../../migrations/0064_site_diary.sql'), 'utf8')).replace(/\r\n/g, '\n');

const SITE_TABLES = [
  'project_assignments',
  'site_location_consents',
  'site_devices',
  'site_visits',
  'site_photos',
  'site_material_receipts',
  'site_notes',
];

describe('0064 takes its locks all or none (S2 reliability R2)', () => {
  const lockBlock = sql.slice(0, sql.indexOf('ALTER TABLE public.projects ADD COLUMN site_lat'));

  it('names the four existing tables, in one fixed order, before any DDL', () => {
    const targets = [...lockBlock.matchAll(/'public\.(\w+):([A-Z ]+)'/g)].map((match) => `${match[1]} ${match[2]}`);
    expect(targets).toEqual([
      'projects ACCESS EXCLUSIVE',
      'contracts ACCESS EXCLUSIVE',
      'contract_lines SHARE ROW EXCLUSIVE',
      'organizations SHARE ROW EXCLUSIVE',
    ]);
  });

  it('never waits for a lock: every LOCK TABLE is NOWAIT, and no lock_timeout is set for one', () => {
    const locks = [...sql.matchAll(/LOCK TABLE[^;']*'?[^;]*/gi)].map((match) => match[0]);
    expect(locks.length).toBeGreaterThan(0);
    for (const lock of locks) expect(lock, lock).toMatch(/NOWAIT/);
    expect(lockBlock).not.toMatch(/lock_timeout/);
  });

  it('retries the whole attempt in a subtransaction, with a short sleep, within ONE 3 s budget, then 55P03', () => {
    const attempt = lockBlock.slice(lockBlock.indexOf('LOOP'));
    expect(attempt).toMatch(/LOOP\s+BEGIN\s+FOREACH lock_target IN ARRAY lock_targets LOOP/);
    expect(attempt).toMatch(/EXIT;\s+EXCEPTION WHEN lock_not_available THEN/);
    expect(attempt).toMatch(/clock_timestamp\(\) - lock_started >= interval '3 seconds'/);
    expect(attempt).toMatch(/RAISE EXCEPTION '0064: could not take every lock within 3 s \(stopped at %\)', lock_target\s+USING ERRCODE = '55P03'/);
    expect(attempt).toMatch(/PERFORM pg_sleep\(0\.01 \+ random\(\) \* 0\.03\)/);
  });
});

describe('0064 creates the seven tables closed (S2 security S5)', () => {
  it.each(SITE_TABLES)('%s: RLS enabled and forced in the migration', (table) => {
    expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
  });

  it('still writes no policy and no grant: those are apply-rls\'s (stack-profile.md)', () => {
    expect(sql).not.toMatch(/\bcreate\s+policy\b/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });
});

describe('0064 stores no photo object key (S2 reliability R1)', () => {
  it('has no display_key or thumb_key anywhere in its executable SQL', () => {
    expect(sql).not.toMatch(/display_key|thumb_key/);
  });
});
