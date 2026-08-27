// Shared-instance isolation (R1/S1) — proves org isolation holds when many
// withOrgContext transactions share ONE postgres.js instance, which is exactly
// what the Cloudflare fix now does (a single request-scoped pool, max:N, reused
// by every withRequestDb call). The other isolation suites each build their own
// createDb(url, { max: 1 }) and so never exercise a pooled multi-socket instance;
// this one does.
//
// Requires: migrations applied, RLS applied, seed run. Runs serially against the
// session pooler (fileParallelism:false), like the sibling isolation tests.
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
// The connection's base login role, captured before any SET LOCAL runs, so the
// reset assertion compares against reality rather than a hard-coded role name.
let baseRole: string;

const ctxA: OrgContext = { orgId: ORG_A_ID, userId: USER_A_ID, role: 'owner' };
const ctxB: OrgContext = { orgId: ORG_B_ID, userId: USER_B_ID, role: 'owner' };

function num(rows: unknown): number {
  return Number((rows as Array<{ n: number }>)[0].n);
}

// One org-scoped read set, under the given context, on the SHARED instance.
async function readMemberships(
  ctx: OrgContext,
  ownOrg: string,
  foreignOrg: string,
): Promise<{ total: number; own: number; foreign: number }> {
  return withOrgContext(db, ctx, async (tx) => {
    const total = await tx.execute(
      sql.raw(`select count(*)::int as n from public.memberships`),
    );
    const own = await tx.execute(
      sql.raw(
        `select count(*)::int as n from public.memberships where org_id = '${ownOrg}'`,
      ),
    );
    const foreign = await tx.execute(
      sql.raw(
        `select count(*)::int as n from public.memberships where org_id = '${foreignOrg}'`,
      ),
    );
    return { total: num(total), own: num(own), foreign: num(foreign) };
  });
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  // A SINGLE shared instance mirroring the CF runtime options (prepare:false,
  // max>1) — this is the object under test.
  const created = createDb(DATABASE_URL, { max: 5, prepare: false });
  db = created.db;
  pg = created.sql;

  const role = await pg<{ role: string }[]>`select current_user as role`;
  baseRole = role[0].role;
});

afterAll(async () => {
  // Close the shared instance so it does not leak against the 15-client
  // session-pooler cap for the rest of the isolation run.
  if (pg) await pg.end();
});

describe('shared postgres.js instance — org isolation across pooled sockets', () => {
  it('captured a non-metra_app base login role', () => {
    expect(baseRole).toBeTruthy();
    expect(baseRole).not.toBe('metra_app');
  });

  it('interleaved org A and org B transactions each see ONLY their own org', async () => {
    // Both transactions run concurrently on the ONE shared instance: each checks
    // out its own socket from the pool, so a GUC/role leak between sockets would
    // show up as cross-org rows here.
    const [a, b] = await Promise.all([
      readMemberships(ctxA, ORG_A_ID, ORG_B_ID),
      readMemberships(ctxB, ORG_B_ID, ORG_A_ID),
    ]);

    expect(a.own, 'org A saw none of its own rows').toBeGreaterThan(0);
    expect(a.foreign, 'org A leaked org B rows on the shared pool').toBe(0);
    expect(a.total, 'org A saw rows beyond its own org').toBe(a.own);

    expect(b.own, 'org B saw none of its own rows').toBeGreaterThan(0);
    expect(b.foreign, 'org B leaked org A rows on the shared pool').toBe(0);
    expect(b.total, 'org B saw rows beyond its own org').toBe(b.own);
  });

  it('repeated interleaving on the same instance stays isolated (no residue build-up)', async () => {
    // Several concurrent rounds increase the chance the same socket is reused
    // across contexts — the case where a missing SET LOCAL reset would leak.
    const rounds = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        i % 2 === 0
          ? readMemberships(ctxA, ORG_A_ID, ORG_B_ID)
          : readMemberships(ctxB, ORG_B_ID, ORG_A_ID),
      ),
    );
    for (const r of rounds) {
      expect(r.foreign, 'cross-org rows leaked on a reused socket').toBe(0);
      expect(r.total).toBe(r.own);
    }
  });

  it('outside any withOrgContext the pooled socket has NO org/role residue', async () => {
    // A bare read on the shared instance, no context: because withOrgContext uses
    // SET LOCAL (transaction-scoped), the socket returned to the pool must carry
    // neither an app.current_org_id nor the metra_app role.
    const rows = (await db.execute(
      sql`select current_setting('app.current_org_id', true) as org, current_user as role`,
    )) as unknown as Array<{ org: string | null; role: string }>;
    const { org, role } = rows[0];

    expect(org ?? '', 'app.current_org_id residue survived the transaction').toBe(
      '',
    );
    expect(role, 'metra_app role residue survived the transaction').not.toBe(
      'metra_app',
    );
    expect(role, 'socket did not return to the base login role').toBe(baseRole);
  });
});
