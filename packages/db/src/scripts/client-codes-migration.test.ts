import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withoutSqlComments } from './rls-catalogue';

// Migration 0066 (client codes DB step D), read as text: the properties of the
// 0064 pattern it must keep, pinned so an edit cannot quietly undo them. The
// rehearsal in docs/DEPLOY.md measures them live.
//
//   * ALL-OR-NONE LOCKS. client_verification_codes is taken with
//     `LOCK TABLE ... NOWAIT` in a subtransaction, retried with a short sleep
//     within one 3 s budget, so the migration never queues behind a code act.
//   * A PLAIN BUILD. `db:migrate` runs the batch in one transaction, where
//     CREATE INDEX CONCURRENTLY cannot run.
//   * EXPAND ONLY. One index; no row, policy or grant.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const sql = withoutSqlComments(
  readFileSync(resolve(here, '../../migrations/0066_client_codes_purge_index.sql'), 'utf8'),
).replace(/\r\n/g, '\n');

describe('0066 takes its lock all or none', () => {
  const lockBlock = sql.slice(0, sql.indexOf('CREATE INDEX'));

  it('names the one existing table, in SHARE mode, before the index build', () => {
    const targets = [...lockBlock.matchAll(/'public\.(\w+):([A-Z ]+)'/g)].map((match) => `${match[1]} ${match[2]}`);
    expect(targets).toEqual(['client_verification_codes SHARE']);
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
    expect(attempt).toMatch(/RAISE EXCEPTION '0066: could not take every lock within 3 s \(stopped at %\)', lock_target\s+USING ERRCODE = '55P03'/);
    expect(attempt).toMatch(/PERFORM pg_sleep\(0\.01 \+ random\(\) \* 0\.03\)/);
  });

  it('builds the index inside the locked block, plainly (a migration runs in a transaction)', () => {
    const build = sql.slice(sql.indexOf('CREATE INDEX'), sql.indexOf('END $$;'));
    expect(build).toContain(
      'CREATE INDEX client_verification_codes_unused_created_idx\n    ON public.client_verification_codes USING btree (created_at) WHERE consumed_at is null;',
    );
    expect(sql).not.toMatch(/CONCURRENTLY/i);
    expect(sql.slice(sql.indexOf('END $$;') + 'END $$;'.length).trim()).toBe('');
  });
});

describe('0066 only expands', () => {
  it('writes no row, policy or grant', () => {
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE)\s/i);
    expect(sql).not.toMatch(/\bcreate\s+policy\b/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });
});
