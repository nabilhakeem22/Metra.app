// Accounts isolation (Epic A, A1) — the account entity sits ABOVE tenancy and
// carries NO org_id, so the org_id auto-gate in cross-tenant.test.ts can't cover
// it. This test proves the bespoke account_isolation policy instead:
//   * under org A's context, exactly org A's one account is visible; org B's is 0;
//   * a forged {orgA, non-member} context sees 0 accounts and cannot INSERT/UPDATE;
//   * the app_bootstrap_account() SDF works, and is NOT executable by
//     public/anon/authenticated/service_role.
// Requires: migrations applied, RLS applied, seed run (each seeded org owns one
// account).
import { randomUUID } from 'node:crypto';
import {
  ORG_A_ID,
  ORG_B_ID,
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
let accountAId: string;
let accountBId: string;

const ctxA: OrgContext = { orgId: ORG_A_ID, userId: USER_A_ID, role: 'owner' };
const ctxB: OrgContext = { orgId: ORG_B_ID, userId: USER_B_ID, role: 'owner' };

// USER_B is a member of org B only — claiming org A with USER_B is a forged
// context the membership second factor must deny.
const ctxForged: OrgContext = {
  orgId: ORG_A_ID,
  userId: USER_B_ID,
  role: 'owner',
  email: 'attacker@evil.example',
};

async function countAccounts(ctx: OrgContext, where = ''): Promise<number> {
  return withOrgContext(db, ctx, async (tx) => {
    const rows = (await tx.execute(
      sql.raw(`select count(*)::int as n from public.accounts ${where}`),
    )) as unknown as Array<{ n: number }>;
    return Number(rows[0].n);
  });
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  const created = createDb(DATABASE_URL, { max: 1, prepare: true });
  db = created.db;
  pg = created.sql;

  // Resolve each seeded org's owning account over the BYPASSRLS connection (the
  // account ids are minted with random uuids by the bootstrap SDF).
  const rows = await pg<{ id: string; account_id: string }[]>`
    select id, account_id from public.organizations
    where id in (${ORG_A_ID}, ${ORG_B_ID})
  `;
  accountAId = rows.find((r) => r.id === ORG_A_ID)!.account_id;
  accountBId = rows.find((r) => r.id === ORG_B_ID)!.account_id;
});

afterAll(async () => {
  if (pg) await pg.end();
});

describe('accounts sit above tenancy but are not cross-tenant readable', () => {
  it('every org has a non-null account_id, all globally distinct (1:1 backfill)', async () => {
    // Global invariant across EVERY org, not just A/B: zero nulls AND the count of
    // orgs equals the count of DISTINCT account_ids (true 1:1, no two orgs share).
    const [row] = await pg<{
      total: number;
      nulls: number;
      distinct_accounts: number;
    }[]>`
      select count(*)::int                       as total,
             count(*) filter (where account_id is null)::int as nulls,
             count(distinct account_id)::int      as distinct_accounts
      from public.organizations
    `;
    expect(Number(row.nulls), 'some org has a null account_id').toBe(0);
    expect(
      Number(row.distinct_accounts),
      'two orgs share an account (not 1:1)',
    ).toBe(Number(row.total));

    expect(accountAId).toBeTruthy();
    expect(accountBId).toBeTruthy();
    expect(accountAId, 'orgs A and B share an account').not.toBe(accountBId);
  });

  it('accounts has FORCE row-level security enabled', async () => {
    const rows = await pg<{ rls: boolean; forced: boolean }[]>`
      select c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'accounts'
    `;
    expect(rows[0]?.rls, 'accounts RLS not enabled').toBe(true);
    expect(rows[0]?.forced, 'accounts does not FORCE RLS').toBe(true);
  });

  it('org A context sees EXACTLY its own one account', async () => {
    const total = await countAccounts(ctxA);
    const own = await countAccounts(ctxA, `where id = '${accountAId}'`);
    const bLeak = await countAccounts(ctxA, `where id = '${accountBId}'`);
    expect(own, "org A cannot see its own account").toBe(1);
    expect(bLeak, 'org A leaked org B account').toBe(0);
    expect(total, 'org A sees more than its own account').toBe(1);
  });

  it('org B context sees EXACTLY its own one account (not org A)', async () => {
    const total = await countAccounts(ctxB);
    const aLeak = await countAccounts(ctxB, `where id = '${accountAId}'`);
    expect(total).toBe(1);
    expect(aLeak, 'org B leaked org A account').toBe(0);
  });

  it('with no org context, accounts returns 0 rows (fails closed)', async () => {
    const rows = await pg.begin(async (tx) => {
      await tx`set local role metra_app`;
      return tx.unsafe(`select count(*)::int as n from public.accounts`);
    });
    expect(Number(rows[0].n), 'accounts leaked without context').toBe(0);
  });
});

describe('accounts — forged non-member context is denied', () => {
  it('forged {orgA, USER_B} sees 0 accounts (incl org A own)', async () => {
    const n = await countAccounts(ctxForged);
    expect(n, 'account visible to a forged non-member').toBe(0);
  });

  it('forged context cannot INSERT an account', async () => {
    // metra_app has no INSERT grant on accounts, so this is denied by the missing
    // privilege FIRST (42501). The policy's `with check (false)` is intentional
    // belt-and-suspenders: it can't actually be exercised here without granting
    // INSERT, which we deliberately don't do — accounts are minted ONLY via the SDF.
    await expect(
      withOrgContext(db, ctxForged, (tx) =>
        tx.execute(
          sql.raw(
            `insert into public.accounts (id, name_en) values ('${randomUUID()}', 'Forged account')`,
          ),
        ),
      ),
    ).rejects.toThrow();
  });

  it('forged context cannot UPDATE org A account (statement is denied outright)', async () => {
    // metra_app holds SELECT-only on accounts (roles.sql), so an UPDATE raises
    // `permission denied for table accounts` (42501) BEFORE RLS row-filtering ever
    // runs — the statement throws rather than affecting 0 rows. Assert the
    // rejection, then confirm the row is untouched over BYPASSRLS.
    await expect(
      withOrgContext(db, ctxForged, (tx) =>
        tx.execute(
          sql.raw(
            `update public.accounts set name_en = 'hacked' where id = '${accountAId}'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    const survived = await pg.unsafe(
      `select name_en from public.accounts where id = '${accountAId}'`,
    );
    expect(survived[0].name_en).not.toBe('hacked');
  });
});

describe('accounts — a legit member also cannot INSERT/UPDATE directly (SDF-only)', () => {
  it('metra_app direct INSERT is refused even for a real org A member', async () => {
    // Same as the forged case: refused by the missing INSERT grant (42501). Proves
    // that even a legitimate member cannot side-step the SDF to forge an account.
    await expect(
      withOrgContext(db, ctxA, (tx) =>
        tx.execute(
          sql.raw(
            `insert into public.accounts (id, name_en) values ('${randomUUID()}', 'Direct insert')`,
          ),
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('app_bootstrap_account SDF — works, and only for metra_app', () => {
  it('mints a fresh unlinked account and returns its id', async () => {
    const created = (await withOrgContext(db, ctxA, (tx) =>
      tx.execute(
        sql`select id from public.app_bootstrap_account('حساب', 'Bootstrap probe')`,
      ),
    )) as unknown as Array<{ id: string }>;
    expect(created.length).toBe(1);
    const newId = created[0].id;
    expect(newId).toBeTruthy();

    // It exists over BYPASSRLS but is UNLINKED (no org owns it) -> invisible to any
    // tenant via the policy. Clean it up.
    const row = await pg.unsafe(
      `select name_en from public.accounts where id = '${newId}'`,
    );
    expect(row[0]?.name_en).toBe('Bootstrap probe');
    await pg.unsafe(`delete from public.accounts where id = '${newId}'`);
  });

  it('is NOT executable by public (nor anon/authenticated/service_role when present)', async () => {
    const [pub] = await pg<{ can: boolean }[]>`
      select has_function_privilege(
        'public', 'public.app_bootstrap_account(text, text)', 'execute'
      ) as can
    `;
    expect(pub.can, 'public can execute app_bootstrap_account').toBe(false);

    for (const role of ['anon', 'authenticated', 'service_role']) {
      const exists = await pg<{ n: number }[]>`
        select count(*)::int as n from pg_roles where rolname = ${role}
      `;
      if (Number(exists[0].n) === 0) continue;
      const [r] = await pg<{ can: boolean }[]>`
        select has_function_privilege(
          ${role}, 'public.app_bootstrap_account(text, text)', 'execute'
        ) as can
      `;
      expect(r.can, `${role} can execute app_bootstrap_account`).toBe(false);
    }
  });

  it('IS executable by metra_app', async () => {
    const [r] = await pg<{ can: boolean }[]>`
      select has_function_privilege(
        'metra_app', 'public.app_bootstrap_account(text, text)', 'execute'
      ) as can
    `;
    expect(r.can, 'metra_app cannot execute app_bootstrap_account').toBe(true);
  });
});
