import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withoutSqlComments } from './rls-catalogue';

// Migration 0065 (client home DB step C), read as text: the properties of the
// 0064 pattern it must keep, pinned so an edit cannot quietly undo them. The
// rehearsal in docs/DEPLOY.md measures them live.
//
//   * ALL-OR-NONE LOCKS. design_engagements (the row every client act locks),
//     organizations and variation_order_events are taken as ONE attempt of
//     `LOCK TABLE ... NOWAIT` in a subtransaction, retried with a short sleep
//     within one 3 s budget, so the migration never WAITS on one table while it
//     holds another.
//   * CLOSED FROM BIRTH. RLS is enabled and forced on client_verification_codes
//     in the migration itself, so an apply-rls that stops before
//     policies/36-client-home.sql leaves it denying everything, never open.
//   * EXPAND ONLY. No row is updated: the new columns arrive with a constant
//     default, which is catalogue only.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const sql = withoutSqlComments(readFileSync(resolve(here, '../../migrations/0065_client_home.sql'), 'utf8')).replace(/\r\n/g, '\n');

describe('0065 takes its locks all or none', () => {
  const lockBlock = sql.slice(0, sql.indexOf('ALTER TABLE public.design_engagements ADD COLUMN entry_phase'));

  it('names the three existing tables, in one fixed order, before any DDL', () => {
    const targets = [...lockBlock.matchAll(/'public\.(\w+):([A-Z ]+)'/g)].map((match) => `${match[1]} ${match[2]}`);
    expect(targets).toEqual([
      'design_engagements ACCESS EXCLUSIVE',
      'organizations SHARE ROW EXCLUSIVE',
      'variation_order_events ACCESS EXCLUSIVE',
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
    expect(attempt).toMatch(/RAISE EXCEPTION '0065: could not take every lock within 3 s \(stopped at %\)', lock_target\s+USING ERRCODE = '55P03'/);
    expect(attempt).toMatch(/PERFORM pg_sleep\(0\.01 \+ random\(\) \* 0\.03\)/);
  });

  it('changes design_engagements and variation_order_events only inside the locked block', () => {
    const afterBlock = sql.slice(sql.indexOf('END $$;'));
    expect(afterBlock).not.toMatch(/ALTER TABLE public\.design_engagements|ON public\.design_engagements/);
    expect(afterBlock).not.toMatch(/variation_order_events/);
  });
});

describe('0065 creates the codes table closed, and only expands', () => {
  it('enables and forces RLS on client_verification_codes in the migration', () => {
    expect(sql).toContain('ALTER TABLE "client_verification_codes" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "client_verification_codes" FORCE ROW LEVEL SECURITY;');
  });

  it('writes no policy and no grant: those are apply-rls\'s (stack-profile.md)', () => {
    expect(sql).not.toMatch(/\bcreate\s+policy\b/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });

  it('updates no row and adds the column with a constant default', () => {
    expect(sql).not.toMatch(/\bUPDATE\s+public\./i);
    expect(sql).toContain("ADD COLUMN entry_phase text DEFAULT 'design' NOT NULL;");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS recorded_on_paper boolean NOT NULL DEFAULT false;');
  });
});
