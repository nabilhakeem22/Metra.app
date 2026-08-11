// Cross-tenant isolation — the P0 exit gate (§4.2).
//
// Discovers every public table carrying `org_id`, then proves that under org A's
// context zero org B rows are visible (and vice versa). Also asserts every such
// table has FORCE RLS + a policy, so the test FAILS if a future table ships
// without protection. Requires: migrations applied, RLS applied, seed run.
import { randomUUID } from 'node:crypto';
import {
  CLIENT_A_ID,
  CLIENT_B_ID,
  COST_ITEM_A_ID,
  INVITE_A_ID,
  ORG_A_ID,
  ORG_B_ID,
  PRICE_CHANGE_A_ID,
  USER_A_ID,
  USER_B_ID,
  createDb,
  withOrgContext,
  type MetraDb,
  type OrgContext,
} from '@metra/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;

let db: MetraDb;
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

  // Discover org_id-bearing tables (runs as the connection role, not metra_app).
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
        await tx`set local role metra_app`;
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

  it('MULTI-ORG USER does not leak: USER_A is in org A AND org B, org A context hides the org B membership', async () => {
    // USER_A has memberships in BOTH orgs (seeded). This is the exact scenario a
    // permissive self-policy would leak. Under org A context USER_A must see
    // ONLY their org A membership row.
    const res = await withOrgContext(db, ctxA, async (tx) => {
      const total = await tx.execute(
        sql.raw(
          `select count(*)::int as n from public.memberships where user_id = '${USER_A_ID}'`,
        ),
      );
      const bLeak = await tx.execute(
        sql.raw(
          `select count(*)::int as n from public.memberships where user_id = '${USER_A_ID}' and org_id = '${ORG_B_ID}'`,
        ),
      );
      return {
        total: Number((total as unknown as Array<{ n: number }>)[0].n),
        bLeak: Number((bLeak as unknown as Array<{ n: number }>)[0].n),
      };
    });
    expect(res.bLeak, 'org A context leaked USER_A org B membership').toBe(0);
    expect(
      res.total,
      'USER_A should see exactly one (org A) membership under org A context',
    ).toBe(1);
  });

  it('bootstrap fn app_current_user_memberships() enumerates the user across orgs (for requireOrg), scoped to the user', async () => {
    // withOrgContext sets app.current_user_id = USER_A, so the SECURITY DEFINER
    // function returns BOTH of USER_A's memberships — that is how requireOrg
    // discovers the org before any context. This is user-scoped, not a widening
    // of org RLS (proven by the assertion above).
    const rows = (await withOrgContext(db, ctxA, (tx) =>
      tx.execute(
        sql.raw(`select org_id from public.app_current_user_memberships()`),
      ),
    )) as unknown as Array<{ org_id: string }>;
    const orgs = rows.map((r) => r.org_id).sort();
    expect(orgs).toContain(ORG_A_ID);
    expect(orgs).toContain(ORG_B_ID);

    // And a DIFFERENT user's context never returns USER_A's rows.
    const asB = (await withOrgContext(db, ctxB, (tx) =>
      tx.execute(
        sql.raw(`select org_id from public.app_current_user_memberships()`),
      ),
    )) as unknown as Array<{ org_id: string }>;
    expect(asB.every((r) => r.org_id === ORG_B_ID)).toBe(true);
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

describe('projects composite same-org FK (§ clients+projects)', () => {
  it('a legit org-A member cannot reference org B client_id (cross-org FK -> 23503)', async () => {
    await expect(
      withOrgContext(db, ctxA, (tx) =>
        tx.execute(
          sql.raw(
            `insert into public.projects (id, org_id, code, name_en, client_id, status)
             values (gen_random_uuid(), '${ORG_A_ID}', 'XORG-${randomUUID()}', 'x', '${CLIENT_B_ID}', 'draft')`,
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('references its OWN org client fine (control)', async () => {
    const code = `OWN-${randomUUID()}`;
    await withOrgContext(db, ctxA, (tx) =>
      tx.execute(
        sql.raw(
          `insert into public.projects (id, org_id, code, name_en, client_id, status)
           values (gen_random_uuid(), '${ORG_A_ID}', '${code}', 'x', '${CLIENT_A_ID}', 'draft')`,
        ),
      ),
    );
    // Cleanup via BYPASSRLS.
    await pg.unsafe(`delete from public.projects where code = '${code}'`);
  });
});

describe('price history is append-only (§ price book, grants)', () => {
  it('accepts INSERT but rejects UPDATE and DELETE on price_changes / price_change_lines', async () => {
    // INSERT succeeds under a real member context.
    await withOrgContext(db, ctxA, async (tx) => {
      await tx.execute(
        sql.raw(
          `insert into public.price_changes
             (id, org_id, category, pct_change, target, effective_date, applied_by, item_count)
           values (gen_random_uuid(), '${ORG_A_ID}', 'civil', 5, 'both', current_date, '${USER_A_ID}', 0)`,
        ),
      );
    });

    // UPDATE / DELETE rejected (no grant) on both history tables.
    for (const stmt of [
      `update public.price_changes set item_count = 999 where org_id = '${ORG_A_ID}'`,
      `delete from public.price_changes where org_id = '${ORG_A_ID}'`,
      `update public.price_change_lines set new_unit_cost = 0 where org_id = '${ORG_A_ID}'`,
      `delete from public.price_change_lines where org_id = '${ORG_A_ID}'`,
    ]) {
      await expect(
        withOrgContext(db, ctxA, (tx) => tx.execute(sql.raw(stmt))),
      ).rejects.toThrow();
    }
  });
});

describe('bilingual present-check (§4.1) — whitespace is not "present"', () => {
  // Own probe org so RLS with_check (id = current_org) passes for the insert.
  const PROBE_ORG = '00000000-0000-4000-8000-0000000000e1';
  const ctxProbe: OrgContext = {
    orgId: PROBE_ORG,
    userId: USER_A_ID,
    role: 'owner',
  };

  function lit(v: string | null): string {
    return v === null ? 'null' : `'${v.replace(/'/g, "''")}'`;
  }

  async function tryInsertOrg(
    nameAr: string | null,
    nameEn: string | null,
  ): Promise<void> {
    await withOrgContext(db, ctxProbe, async (tx) => {
      await tx.execute(
        sql.raw(
          `insert into public.organizations (id, name_ar, name_en)
           values ('${PROBE_ORG}', ${lit(nameAr)}, ${lit(nameEn)})`,
        ),
      );
    });
  }

  async function cleanup(): Promise<void> {
    // Delete via the postgres (BYPASSRLS) connection — the throwaway org has no
    // membership, so the new membership-gated policy would block a metra_app
    // delete. postgres bypasses RLS, so teardown always succeeds.
    await pg.unsafe(
      `delete from public.organizations where id = '${PROBE_ORG}'`,
    );
  }

  afterAll(cleanup);

  it('REJECTS tab/newline-only names (btrim would have missed these)', async () => {
    await cleanup();
    await expect(tryInsertOrg('\t\n ', '  \t')).rejects.toThrow();
  });

  it('REJECTS space-only, empty-string and NULL both sides', async () => {
    await cleanup();
    await expect(tryInsertOrg('   ', '')).rejects.toThrow();
    await expect(tryInsertOrg(null, null)).rejects.toThrow();
    await expect(tryInsertOrg('', null)).rejects.toThrow();
  });

  it('ACCEPTS a real value in either language', async () => {
    await cleanup();
    await expect(tryInsertOrg('شركة حقيقية', null)).resolves.toBeUndefined();
    await cleanup();
    await expect(tryInsertOrg(null, 'Real Co')).resolves.toBeUndefined();
    await cleanup();
  });
});

// USER_B is a member of org B only — NOT of org A. A context claiming org A with
// USER_B is a forged context (e.g. a hand-set app.current_org_id or a stolen
// org id). The membership second factor must deny everything.
const USER_C_ID = '00000000-0000-4000-8000-0000000000c3';
const ctxForged: OrgContext = {
  orgId: ORG_A_ID,
  userId: USER_B_ID,
  role: 'owner',
  email: 'attacker@evil.example',
};

async function rowsUnder(ctx: OrgContext, rawSql: string): Promise<unknown[]> {
  return withOrgContext(db, ctx, (tx) =>
    tx.execute(sql.raw(rawSql)),
  ) as unknown as Promise<unknown[]>;
}

describe('membership second factor — forged context is denied', () => {
  it('forged {orgA, USER_B} sees 0 rows in every org_id table (incl A own rows)', async () => {
    for (const table of orgIdTables) {
      const n = await countAll(ctxForged, table);
      expect(n, `${table} visible to a forged non-member`).toBe(0);
    }
  });

  it('forged context cannot INSERT into files / invitations / audit_log', async () => {
    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.files (id, org_id, entity, object_key)
         values (gen_random_uuid(), '${ORG_A_ID}', 'x', '${ORG_A_ID}/x/${randomUUID()}')`,
      ),
    ).rejects.toThrow();

    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.invitations (id, org_id, email, role, token_hash, status, invited_by, expires_at)
         values (gen_random_uuid(), '${ORG_A_ID}', 'x@x.com', 'viewer', 'h-${randomUUID()}', 'pending', '${USER_B_ID}', now() + interval '7 days')`,
      ),
    ).rejects.toThrow();

    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.audit_log (id, org_id, actor_user_id, entity, action)
         values (gen_random_uuid(), '${ORG_A_ID}', '${USER_B_ID}', 'x', 'create')`,
      ),
    ).rejects.toThrow();
  });

  it('forged context cannot INSERT into cost_items / price_changes / price_change_lines', async () => {
    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.cost_items (id, org_id, code, name_en, category, unit)
         values (gen_random_uuid(), '${ORG_A_ID}', 'FORGE-${randomUUID()}', 'x', 'civil', 'sqm')`,
      ),
    ).rejects.toThrow();

    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.price_changes (id, org_id, category, pct_change, target, effective_date, applied_by, item_count)
         values (gen_random_uuid(), '${ORG_A_ID}', 'civil', 10, 'both', current_date, '${USER_B_ID}', 0)`,
      ),
    ).rejects.toThrow();

    // Valid composite FKs (seeded rows) so RLS — not a FK error — is the reason.
    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.price_change_lines
           (id, org_id, price_change_id, cost_item_id, old_unit_cost, new_unit_cost, old_unit_price, new_unit_price)
         values (gen_random_uuid(), '${ORG_A_ID}', '${PRICE_CHANGE_A_ID}', '${COST_ITEM_A_ID}', 1, 2, 1, 2)`,
      ),
    ).rejects.toThrow();
  });

  it('forged context cannot INSERT into clients / projects', async () => {
    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.clients (id, org_id, name_en)
         values (gen_random_uuid(), '${ORG_A_ID}', 'Forged client')`,
      ),
    ).rejects.toThrow();

    // Valid org-A client_id (seeded) so RLS — not the FK — is the reason.
    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.projects (id, org_id, code, name_en, client_id, status)
         values (gen_random_uuid(), '${ORG_A_ID}', 'FORGE-${randomUUID()}', 'x', '${CLIENT_A_ID}', 'draft')`,
      ),
    ).rejects.toThrow();
  });

  it('forged context cannot UPDATE or DELETE org A rows (0 affected; rows survive)', async () => {
    const upd = await rowsUnder(
      ctxForged,
      `update public.memberships set role = 'admin' where org_id = '${ORG_A_ID}' returning id`,
    );
    expect(upd.length, 'forged UPDATE affected org A memberships').toBe(0);

    const del = await rowsUnder(
      ctxForged,
      `delete from public.files where org_id = '${ORG_A_ID}' returning id`,
    );
    expect(del.length, 'forged DELETE affected org A files').toBe(0);

    // Confirm A's rows still exist (postgres/BYPASSRLS view).
    const mem = await pg.unsafe(
      `select count(*)::int as n from public.memberships where org_id = '${ORG_A_ID}'`,
    );
    expect(Number(mem[0].n)).toBeGreaterThan(0);
  });

  it('forged context cannot insert its OWN membership (self-join) nor another user membership', async () => {
    // {A, USER_B}: bootstrap branch needs app_can_bootstrap_membership() — org A
    // already has members and USER_B has no accepted invite -> rejected.
    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.memberships (id, org_id, user_id, role)
         values (gen_random_uuid(), '${ORG_A_ID}', '${USER_B_ID}', 'admin')`,
      ),
    ).rejects.toThrow();

    // {A, USER_C}: user_id != current_user -> bootstrap branch false -> rejected.
    await expect(
      rowsUnder(
        ctxForged,
        `insert into public.memberships (id, org_id, user_id, role)
         values (gen_random_uuid(), '${ORG_A_ID}', '${USER_C_ID}', 'admin')`,
      ),
    ).rejects.toThrow();
  });

  it('app_claim_invitation with a non-matching email claims nothing (invite stays pending)', async () => {
    const claimed = await rowsUnder(
      ctxForged,
      `select id from public.app_claim_invitation('${INVITE_A_ID}')`,
    );
    expect(claimed.length, 'forged email claimed the invite').toBe(0);

    const status = await pg.unsafe(
      `select status from public.invitations where id = '${INVITE_A_ID}'`,
    );
    expect(status[0].status).toBe('pending');
  });
});

describe('membership second factor — bootstrap carve-outs still work', () => {
  const O1 = randomUUID(); // createOrg sim
  const U1 = randomUUID();
  const O2 = randomUUID(); // acceptInvite sim
  const OWNER_D = randomUUID();
  const UC = randomUUID();
  const INV2 = randomUUID();
  const UC_EMAIL = 'boot-uc@example.com';

  afterAll(async () => {
    // Teardown via postgres/BYPASSRLS.
    await pg.unsafe(
      `delete from public.memberships where org_id in ('${O1}','${O2}')`,
    );
    await pg.unsafe(
      `delete from public.invitations where org_id in ('${O1}','${O2}')`,
    );
    await pg.unsafe(
      `delete from public.organizations where id in ('${O1}','${O2}')`,
    );
  });

  it('createOrg bootstrap: founding org + owner membership insert AND read back', async () => {
    const res = await withOrgContext(
      db,
      { orgId: O1, userId: U1, role: 'owner' },
      async (tx) => {
        await tx.execute(
          sql.raw(
            `insert into public.organizations (id, name_en) values ('${O1}', 'Boot Co')`,
          ),
        );
        await tx.execute(
          sql.raw(
            `insert into public.memberships (id, org_id, user_id, role)
             values (gen_random_uuid(), '${O1}', '${U1}', 'owner')`,
          ),
        );
        const org = (await tx.execute(
          sql.raw(
            `select count(*)::int as n from public.organizations where id = '${O1}'`,
          ),
        )) as unknown as Array<{ n: number }>;
        const mem = (await tx.execute(
          sql.raw(
            `select count(*)::int as n from public.memberships where org_id = '${O1}'`,
          ),
        )) as unknown as Array<{ n: number }>;
        return { org: Number(org[0].n), mem: Number(mem[0].n) };
      },
    );
    expect(res.org).toBe(1);
    expect(res.mem).toBe(1);
  });

  it('acceptInvite bootstrap: claim + own-membership insert when the org already has a member', async () => {
    // Setup via postgres/BYPASSRLS: org + an existing owner + a pending invite
    // for UC's email. Zero-members branch is false, so bootstrap must rely on the
    // accepted-invite branch (armed by app_claim_invitation).
    await pg.unsafe(
      `insert into public.organizations (id, name_en) values ('${O2}', 'Invite Co')`,
    );
    await pg.unsafe(
      `insert into public.memberships (id, org_id, user_id, role)
       values (gen_random_uuid(), '${O2}', '${OWNER_D}', 'owner')`,
    );
    await pg.unsafe(
      `insert into public.invitations (id, org_id, email, role, token_hash, status, invited_by, expires_at)
       values ('${INV2}', '${O2}', '${UC_EMAIL}', 'viewer', 'boot-hash-${INV2}', 'pending', '${OWNER_D}', now() + interval '7 days')`,
    );

    const res = await withOrgContext(
      db,
      { orgId: O2, userId: UC, role: 'viewer', email: UC_EMAIL },
      async (tx) => {
        const claimed = (await tx.execute(
          sql.raw(`select id from public.app_claim_invitation('${INV2}')`),
        )) as unknown as unknown[];

        await tx.execute(
          sql.raw(
            `insert into public.memberships (id, org_id, user_id, role)
             values (gen_random_uuid(), '${O2}', '${UC}', 'viewer')`,
          ),
        );

        const mine = (await tx.execute(
          sql.raw(
            `select count(*)::int as n from public.memberships where user_id = '${UC}'`,
          ),
        )) as unknown as Array<{ n: number }>;

        return { claimed: claimed.length, mine: Number(mine[0].n) };
      },
    );

    expect(res.claimed, 'claim did not return the invite').toBe(1);
    expect(res.mine, 'own membership not inserted/visible').toBe(1);
  });
});
