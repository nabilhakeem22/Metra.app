import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withoutSqlComments } from './rls-catalogue';

// Migration 0067 (security batch 3), read as text, so an edit cannot quietly
// undo what it must keep. CI's from-scratch replay applies it for real.
//
//   * CLOSED FROM BIRTH. RLS is enabled and forced on sign_in_failures in the
//     migration itself: an apply-rls that stops before policies/00-core.sql
//     leaves the table denying everything, never open.
//   * NOTHING EXISTING IS LOCKED. It creates a new table and sets one function
//     setting, so it needs no lock block and no request queues behind it.
//   * SCHEMA ONLY. The policy, the revoke and the two functions are apply-rls's.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const sql = withoutSqlComments(readFileSync(resolve(here, '../../migrations/0067_security_batch_3.sql'), 'utf8')).replace(/\r\n/g, '\n');
const statements = sql.split(';').map((statement) => statement.trim().replace(/\s+/g, ' ')).filter(Boolean);

describe('0067 creates sign_in_failures closed', () => {
  it('declares the three columns, the hash as the primary key, and both named CHECKs', () => {
    const create = statements.find((statement) => statement.startsWith('CREATE TABLE "sign_in_failures"'));
    expect(create).toBe(
      'CREATE TABLE "sign_in_failures" ( "identifier_hash" text PRIMARY KEY NOT NULL, ' +
        '"window_started_at" timestamp with time zone DEFAULT now() NOT NULL, ' +
        '"failures" smallint DEFAULT 1 NOT NULL, ' +
        `CONSTRAINT "sign_in_failures_identifier_hash_shape" CHECK (identifier_hash ~ '^[0-9a-f]{64}$'), ` +
        'CONSTRAINT "sign_in_failures_failures_range" CHECK (failures between 1 and 100) )',
    );
  });

  it('enables and forces RLS in the migration, and builds the window index', () => {
    expect(statements).toContain('ALTER TABLE "sign_in_failures" ENABLE ROW LEVEL SECURITY');
    expect(statements).toContain('ALTER TABLE "sign_in_failures" FORCE ROW LEVEL SECURITY');
    expect(statements).toContain(
      'CREATE INDEX "sign_in_failures_window_started_idx" ON "sign_in_failures" USING btree ("window_started_at")',
    );
  });
});

describe('0067 pins the search_path of text_has_visible_character (A4)', () => {
  it('sets it to the empty string, and changes nothing else about the function', () => {
    const alters = statements.filter((statement) => /^alter\s+function\b/i.test(statement));
    expect(alters).toEqual(["ALTER FUNCTION public.text_has_visible_character(text) SET search_path = ''"]);
    expect(sql).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/i);
  });
});

describe('0067 is schema only and touches no existing table', () => {
  it('runs exactly five statements', () => {
    expect(statements).toHaveLength(5);
  });

  it('writes no policy, grant or trigger: those are apply-rls\'s (stack-profile.md)', () => {
    expect(sql).not.toMatch(/\bpolicy\b/i);
    expect(sql).not.toMatch(/\b(?:grant|revoke)\b/i);
    expect(sql).not.toMatch(/\btrigger\b/i);
  });

  it('takes no lock and alters no table but the one it creates', () => {
    expect(sql).not.toMatch(/\block\b/i);
    const altered = [...sql.matchAll(/\balter\s+table\s+(?:only\s+)?(?:public\.)?"?(\w+)"?/gi)].map((match) => match[1]);
    expect(altered).toEqual(['sign_in_failures', 'sign_in_failures']);
    expect(sql).not.toMatch(/\b(?:update|insert|delete|drop|truncate)\b/i);
  });
});
