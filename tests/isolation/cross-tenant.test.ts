// Cross-tenant isolation — the P0 exit gate (§4.2).
//
// Discovers every public table carrying `org_id`, then proves that under org A's
// context zero org B rows are visible (and vice versa). Also asserts every such
// table has FORCE RLS + a policy, so the test FAILS if a future table ships
// without protection. Requires: migrations applied, RLS applied, seed run.
import {
  ORG_A_ID,
  ORG_B_ID,
  USER_A_ID,
  USER_B_ID,
  createDb,
  withOrgContext,
  type MertaDb,
  type OrgContext,
} from '@merta/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;

let db: MertaDb;
let pg: ReturnType<typeof createDb>['sql'];
let orgIdTables: string[] = [];

const IDENT = /^[a-z_][a-z0-9_]*$/;

const ctxA: OrgContext = { orgId: ORG_A_ID, userId: USER_A_ID, role: 'owner' };
const ctxB: OrgContext = { orgId: ORG_B_ID, userId: USER_B_ID, role: 'owner' };

async function countWhereOrg(
  ctx: OrgContext,
  table: string,
  orgId: string,
): Promise<number> {
  if (!IDENT.test(table)) throw new Error(`unsafe table name: ${table}`);
  return withOrgContext(db, ctx, async (tx) => {
    const rows = await tx.execute(
      sql.raw(
        `select count(*)::int as n from public."${table}" where org_id = '${orgId}'`,
      ),
    );
    return Number((rows as unknown as Array<{ n: number }>)[0].n);
  });
}

async function countAll(ctx: OrgContext, table: string): Promise<number> {
  if (!IDENT.test(table)) throw new Error(`unsafe table name: ${table}`);
  return withOrgContext(db, ctx, async (tx) => {
    const rows = await tx.execute(
      sql.raw(`select count(*)::int as n from public."${table}"`),
    );
    return Number((rows as unknown as Array<{ n: number }>)[0].n);
  });
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  const created = createDb(DATABASE_URL, { max: 1, prepare: true });
  db = created.db;
  pg = created.sql;

  // Discover org_id-bearing tables (runs as the connection role, not merta_app).
  const discovered = await pg<{ table_name: string }[]>`
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'org_id'
      and t.table_type = 'BASE TABLE'
    order by c.table_name
  `;
  orgIdTables = discovered.map((r) => r.table_name);
});

afterAll(async () => {
  if (pg) await pg.end();
});

describe('cross-tenant isolation', () => {
  it('found org_id-bearing tables to check', () => {
    expect(orgIdTables.length).toBeGreaterThan(0);
  });

  it('every org_id table has FORCE row-level security enabled', async () => {
    const rows = await pg<{ relname: string; rls: boolean; forced: boolean }[]>`
      select c.relname,
             c.relrowsecurity as rls,
             c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(${orgIdTables})
    `;
    for (const table of orgIdTables) {
      const row = rows.find((r) => r.relname === table);
      expect(row, `${table} missing from pg_class`).toBeDefined();
      expect(row!.rls, `${table} does not have RLS enabled`).toBe(true);
      expect(row!.forced, `${table} does not FORCE RLS`).toBe(true);
    }
  });

  it('every org_id table has at least one policy', async () => {
    const rows = await pg<{ tablename: string }[]>`
      select tablename from pg_policies
      where schemaname = 'public' and tablename = any(${orgIdTables})
    `;
    const withPolicy = new Set(rows.map((r) => r.tablename));
    for (const table of orgIdTables) {
      expect(withPolicy.has(table), `${table} has no RLS policy`).toBe(true);
    }
  });

  it('with no org context, every org_id table returns 0 rows (fails closed)', async () => {
    for (const table of orgIdTables) {
      const rows = await pg.begin(async (tx) => {
        await tx`set local role merta_app`;
        return tx.unsafe(`select count(*)::int as n from public."${table}"`);
      });
      expect(Number(rows[0].n), `${table} leaked without context`).toBe(0);
    }
  });

  it('org A context sees 0 org B rows in every table', async () => {
    for (const table of orgIdTables) {
      const leaked = await countWhereOrg(ctxA, table, ORG_B_ID);
      expect(leaked, `${table} leaked org B rows to org A`).toBe(0);
    }
  });

  it('org B context sees 0 org A rows in every table', async () => {
    for (const table of orgIdTables) {
      const leaked = await countWhereOrg(ctxB, table, ORG_A_ID);
      expect(leaked, `${table} leaked org A rows to org B`).toBe(0);
    }
  });

  it('context is not merely failing closed: org A sees its own seeded rows', async () => {
    // memberships is seeded for both orgs; org A must see exactly its own.
    const own = await countWhereOrg(ctxA, 'memberships', ORG_A_ID);
    const all = await countAll(ctxA, 'memberships');
    expect(own).toBeGreaterThan(0);
    expect(all).toBe(own); // sees only its own
  });
});

describe('audit_log immutability (§4.4)', () => {
  it('accepts INSERT but rejects UPDATE and DELETE for the app role', async () => {
    // INSERT succeeds under org context.
    await withOrgContext(db, ctxA, async (tx) => {
      await tx.execute(
        sql.raw(
          `insert into public.audit_log (id, org_id, actor_user_id, entity, action)
           values (gen_random_uuid(), '${ORG_A_ID}', '${USER_A_ID}', 'immutability_probe', 'create')`,
        ),
      );
    });

    // UPDATE is rejected (no grant).
    await expect(
      withOrgContext(db, ctxA, async (tx) => {
        await tx.execute(
          sql.raw(
            `update public.audit_log set entity = 'tampered' where entity = 'immutability_probe'`,
          ),
        );
      }),
    ).rejects.toThrow();

    // DELETE is rejected (no grant).
    await expect(
      withOrgContext(db, ctxA, async (tx) => {
        await tx.execute(
          sql.raw(
            `delete from public.audit_log where entity = 'immutability_probe'`,
          ),
        );
      }),
    ).rejects.toThrow();
  });
});
