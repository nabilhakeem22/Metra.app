import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Round C (0058), defence in depth: the Supabase API roles must reach nothing
// in `public`, even if the Data API is switched back on. roles.sql removes
// their table and sequence grants and the connection role's default
// privileges for them, guarded per role (a plain Postgres has neither). The
// database half is the delivery-db-step-0058-api-roles dbtest; this pins the
// statements so a later edit cannot quietly drop one.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/rls
const roles = readFileSync(resolve(here, 'roles.sql'), 'utf8').replace(/\r\n/g, '\n');

describe('roles.sql takes every public table and sequence away from anon and authenticated', () => {
  const block = roles.slice(roles.indexOf("foreach r in array array['anon', 'authenticated'] loop"));

  it('loops over exactly the two API roles, each guarded by pg_roles', () => {
    expect(block.length).toBeLessThan(roles.length);
    expect(block).toContain("if exists (select 1 from pg_roles where rolname = r) then");
  });

  it('revokes the existing grants and the default privileges, for tables and sequences', () => {
    for (const statement of [
      "'revoke all on all tables in schema public from %I'",
      "'revoke all on all sequences in schema public from %I'",
      "'alter default privileges in schema public revoke all on tables from %I'",
      "'alter default privileges in schema public revoke all on sequences from %I'",
    ]) {
      expect(block).toContain(statement);
    }
  });

  it('never grants a table or sequence to an API role anywhere in the file', () => {
    expect(roles).not.toMatch(/grant\s+[^;]*\s+on\s+(all\s+tables|all\s+sequences|public\.)[^;]*\bto\s+(anon|authenticated)\b/i);
  });
});
