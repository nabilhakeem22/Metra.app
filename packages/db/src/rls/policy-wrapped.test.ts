import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withoutSqlComments } from '../scripts/rls-catalogue';
import { RLS_APPLY_ORDER } from './manifest';

// Stage 2, DB step A: every RLS policy evaluates its context reads ONCE per
// query. Written bare, `public.app_is_current_org_member()` and the
// `current_setting(...)` comparand run once per ROW; wrapped in `(select ...)`
// the planner hoists them into an InitPlan. Same answer (the helpers take no
// argument and are STABLE; a GUC is fixed for the statement), about 25x
// cheaper on a large scan (B1 security tester: 445 ms vs 17.6 ms on a
// 50,000-line contract). This pins the wrapped form so a new or edited policy
// cannot quietly go back to per-row.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/rls

const CONTEXT_READS = [
  "nullif(current_setting('app.current_org_id', true), '')",
  "nullif(current_setting('app.current_user_id', true), '')",
  'public.app_is_current_org_member()',
  'public.app_can_bootstrap_membership()',
];

const POLICY_FILES = RLS_APPLY_ORDER.filter((file) => file.startsWith('policies/'));

/** Every occurrence of `read` in `sql` that is not directly inside `(select `. */
function unwrapped(sql: string, read: string): number {
  let count = 0;
  for (let at = sql.indexOf(read); at !== -1; at = sql.indexOf(read, at + read.length)) {
    if (sql.slice(Math.max(0, at - 8), at) !== '(select ') count += 1;
  }
  return count;
}

describe('every RLS policy reads its context once per query', () => {
  it('checks the policy files the manifest applies', () => {
    expect(POLICY_FILES.length).toBeGreaterThanOrEqual(8);
    expect(POLICY_FILES).toContain('policies/35-execution.sql');
  });

  for (const file of POLICY_FILES) {
    it(`${file}: no bare context read in executable SQL`, () => {
      const sql = withoutSqlComments(readFileSync(resolve(here, file), 'utf8'));
      const bare = CONTEXT_READS.filter((read) => unwrapped(sql, read) > 0);
      expect(bare, `${file} reads these per row; write them as (select ...)`).toEqual([]);
    });
  }

  it('still finds the wrapped reads (the scan is not reading nothing)', () => {
    const sql = withoutSqlComments(readFileSync(resolve(here, 'policies/30-contracts-boqs-variations.sql'), 'utf8'));
    expect(sql.split('(select public.app_is_current_org_member())').length - 1).toBeGreaterThanOrEqual(20);
  });
});
