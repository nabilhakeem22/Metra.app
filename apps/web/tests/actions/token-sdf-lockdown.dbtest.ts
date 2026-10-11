import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw } from './fixture';
import { signatureOf, TOKEN_SDFS } from './token-sdfs';

// Moved out of delivery-documents.dbtest.ts (Round D): the class-wide lockdown
// of every public token function, over the list in ./token-sdfs.ts.

afterAll(async () => {
  await closeFixture();
});

describe('token SDFs are not EXECUTE TO PUBLIC (S1, whole class)', () => {
  it('covers EVERY app_*_by_token function that exists in the database', async () => {
    // Guards against the table drifting behind functions.sql: if someone adds a new
    // token SDF and does not list it above, this fails and points at the name.
    const rows = await raw.query<{ proname: string }>(
      `select distinct p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where p.proname like 'app\\_%\\_by\\_token'`,
    );
    const discovered = rows.map((r) => r.proname).sort();
    const declared = [...new Set(TOKEN_SDFS.map((s) => s.name))].sort();
    expect(discovered).toEqual(declared);
    // An overload shares its name, so every SIGNATURE must be listed as well.
    const [signatures] = await raw.query<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where p.proname like 'app\\_%\\_by\\_token'`,
    );
    expect(signatures.n).toBe(TOKEN_SDFS.length);
  });

  it('NONE of them grants EXECUTE to PUBLIC', async () => {
    const rows = await raw.query<{
      proname: string;
      has_acl: boolean;
      public_execute: boolean;
    }>(
      `select p.proname,
              p.proacl is not null as has_acl,
              exists (
                select 1 from aclexplode(p.proacl) a
                where a.grantee = 0 and a.privilege_type = 'EXECUTE'
              ) as public_execute
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
        where p.proname in (${TOKEN_SDFS.map((s) => `'${s.name}'`).join(', ')})`,
    );
    expect(rows.length).toBe(TOKEN_SDFS.length);
    for (const row of rows) {
      // A NULL proacl means "defaults apply", and CREATE FUNCTION's default IS
      // EXECUTE TO PUBLIC — so a null acl is a FAILURE, not a pass.
      expect({ fn: row.proname, hasAcl: row.has_acl }).toEqual({
        fn: row.proname,
        hasAcl: true,
      });
      expect({ fn: row.proname, publicExecute: row.public_execute }).toEqual({
        fn: row.proname,
        publicExecute: false,
      });
    }
  });

  it('the Supabase api roles cannot execute them either (when those roles exist)', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const [present] = await raw.query<{ n: number }>(
        `select count(*)::int as n from pg_roles where rolname = '${role}'`,
      );
      // A plain Postgres (CI) has no Supabase api roles — nothing to assert there.
      if (Number(present.n) === 0) continue;
      for (const sdf of TOKEN_SDFS) {
        const signature = signatureOf(sdf);
        const [row] = await raw.query<{ allowed: boolean }>(
          `select has_function_privilege('${role}', '${signature}', 'execute') as allowed`,
        );
        expect({ role, signature, allowed: row.allowed }).toEqual({
          role,
          signature,
          allowed: false,
        });
      }
    }
  });

  it('metra_app CAN execute all of them (the app path is not broken by the revokes)', async () => {
    for (const sdf of TOKEN_SDFS) {
      const signature = signatureOf(sdf);
      const [row] = await raw.query<{ allowed: boolean }>(
        `select has_function_privilege('metra_app', '${signature}', 'execute') as allowed`,
      );
      expect({ signature, allowed: row.allowed }).toEqual({ signature, allowed: true });
    }
  });
});
