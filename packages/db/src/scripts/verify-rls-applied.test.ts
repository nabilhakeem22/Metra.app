import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { grantedUpdateColumns } from './design-engagement-grant';
import { declaredFunctions, declaredPolicies, declaredTriggers } from './rls-catalogue';
import { declaredTables } from './schema-catalogue';
import { declaredCounts, verifyRlsApplied } from './verify-rls-applied';

// S2 / R5: `apply-rls` had fifteen stop points and no post-condition beyond "no
// statement threw". These cases pin the read-back with a FIXTURE socket - the
// queries are static tagged templates, so answering on the query text exercises
// the real control flow without a database.

interface Catalogues {
  /** Tables to report as NOT forced, as table -> the flags the database has. */
  rlsFlags?: Record<string, { enabled: boolean; forced: boolean }>;
  droppedPolicies?: string[];
  droppedTriggers?: string[];
  droppedFunctions?: string[];
  role?: { canLogin: boolean; bypassRls: boolean } | null;
  /** The design_engagements UPDATE authority this database holds. */
  grant?: { tableLevel: boolean; columns: string[] };
}

const ROLES_SQL = resolve(dirname(fileURLToPath(import.meta.url)), '../rls/roles.sql');

/** Exactly what roles.sql grants — the shape a correctly applied database has. */
function appliedGrant(): { tableLevel: boolean; columns: string[] } {
  return { tableLevel: false, columns: grantedUpdateColumns(readFileSync(ROLES_SQL, 'utf8')) };
}

function fixtureSql(catalogues: Catalogues) {
  // Order matters: the trigger read JOINS pg_class, so the RLS-flag branch must
  // be the LAST one tested, not the first.
  const sql = (strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    if (text.includes('pg_policies')) {
      return Promise.resolve(
        [...declaredPolicies().keys()]
          .filter((key) => !catalogues.droppedPolicies?.includes(key))
          .map((key) => ({ tablename: key.split('.')[0], policyname: key.split('.')[1] })),
      );
    }
    if (text.includes('pg_trigger')) {
      return Promise.resolve(
        [...declaredTriggers().keys()]
          .filter((key) => !catalogues.droppedTriggers?.includes(key))
          .map((key) => ({ tablename: key.split('.')[0], triggername: key.split('.')[1] })),
      );
    }
    if (text.includes('pg_proc')) {
      return Promise.resolve(
        [...declaredFunctions().keys()]
          .filter((name) => !catalogues.droppedFunctions?.includes(name))
          .map((name) => ({ name })),
      );
    }
    if (text.includes('has_table_privilege')) {
      const grant = catalogues.grant ?? appliedGrant();
      return Promise.resolve([
        { tableLevel: grant.tableLevel, columnLevel: grant.columns.length > 0 },
      ]);
    }
    if (text.includes('column_privileges')) {
      const grant = catalogues.grant ?? appliedGrant();
      return Promise.resolve(grant.columns.map((name) => ({ name })));
    }
    if (text.includes('pg_roles')) {
      const role =
        catalogues.role === undefined ? { canLogin: false, bypassRls: false } : catalogues.role;
      return Promise.resolve(role === null ? [] : [role]);
    }
    return Promise.resolve(
      [...declaredTables().keys()].map((name) => ({
        name,
        ...(catalogues.rlsFlags?.[name] ?? { enabled: true, forced: true }),
      })),
    );
  };
  return sql as unknown as Parameters<typeof verifyRlsApplied>[0];
}

describe('verifyRlsApplied', () => {
  it('reports nothing when every declared object is in the catalogues', async () => {
    expect(await verifyRlsApplied(fixtureSql({}))).toEqual([]);
  });

  it('catches a policy file that never ran — the D7 failure shape, at the database', async () => {
    // A whole file missing is a lot of policies; one is enough to prove the
    // comparison, and the message names the file that declares it.
    const problems = await verifyRlsApplied(
      fixtureSql({ droppedPolicies: ['clients.org_isolation'] }),
    );
    expect(problems).toEqual([
      '  - policy clients.org_isolation is declared in rls/policies/10-catalogue.sql and is NOT in the database',
    ]);
  });

  it('catches a table with RLS enabled but NOT forced', async () => {
    const problems = await verifyRlsApplied(
      fixtureSql({ rlsFlags: { clients: { enabled: true, forced: false } } }),
    );
    expect(problems).toEqual([
      '  - table clients has RLS enabled=true forced=false — both must be true',
    ]);
  });

  it('catches a missing trigger and a missing function', async () => {
    const problems = await verifyRlsApplied(
      fixtureSql({
        droppedTriggers: ['boqs.trg_boqs_immutable'],
        droppedFunctions: ['enforce_boq_child_draft'],
      }),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('trigger boqs.trg_boqs_immutable');
    expect(problems[1]).toContain('function enforce_boq_child_draft');
  });

  it('catches a missing metra_app, and one that is too strong', async () => {
    expect(await verifyRlsApplied(fixtureSql({ role: null }))).toEqual([
      '  - role metra_app does not exist — roles.sql did not run',
    ]);
    const problems = await verifyRlsApplied(
      fixtureSql({ role: { canLogin: true, bypassRls: true } }),
    );
    expect(problems).toEqual([
      '  - role metra_app is too strong: canlogin=true bypassrls=true — it must be neither',
    ]);
  });

  it('reports EVERY problem, not just the first', async () => {
    const problems = await verifyRlsApplied(
      fixtureSql({
        rlsFlags: { clients: { enabled: false, forced: false } },
        droppedPolicies: ['clients.org_isolation', 'boqs.org_isolation'],
        droppedTriggers: ['boqs.trg_boqs_immutable'],
        droppedFunctions: ['enforce_immutable_when'],
        role: null,
      }),
    );
    expect(problems).toHaveLength(6);
  });

  it('prints the declared counts a green run reports', () => {
    expect(declaredCounts()).toBe('46 tables, 46 policies, 12 triggers, 30 functions');
  });
});

describe('the design_engagements UPDATE narrowing, at the DATABASE (S4)', () => {
  // `apply-rls` printed "verified in the catalogues — 46 tables, 46 policies, 12
  // triggers, 30 functions, role metra_app present" whether that table's UPDATE
  // was fifteen columns or the whole row: `verifyRlsApplied` read no grant of any
  // kind. The wave's central authority change was verified only by a static parse
  // of roles.sql, which is text, on a machine with no database.
  it('reports nothing when the applied grant is exactly what roles.sql says', async () => {
    expect(await verifyRlsApplied(fixtureSql({}))).toEqual([]);
  });

  it('catches a TABLE-LEVEL update, which makes the column list cosmetic', async () => {
    const problems = await verifyRlsApplied(
      fixtureSql({ grant: { ...appliedGrant(), tableLevel: true } }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('has TABLE-LEVEL update on design_engagements');
  });

  it('catches a column roles.sql grants that the database does not have', async () => {
    const short = appliedGrant();
    const problems = await verifyRlsApplied(
      fixtureSql({
        grant: { tableLevel: false, columns: short.columns.filter((c) => c !== 'off_plan') },
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('is MISSING off_plan');
  });

  it('catches a column the database has that roles.sql does NOT grant', async () => {
    // The direction that matters most: `free_revision_n` is an allowance, and an
    // allowance that can be raised after the fact is a free revision minted out
    // of nothing.
    const problems = await verifyRlsApplied(
      fixtureSql({
        grant: { tableLevel: false, columns: [...appliedGrant().columns, 'free_revision_n'] },
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('carries free_revision_n, which rls/roles.sql does not grant');
  });

  it('catches an UPDATE that was revoked away entirely', async () => {
    // What a `revoke update` appended below the column grant leaves behind: no
    // authority at all, and every transition 42501s.
    const problems = await verifyRlsApplied(
      fixtureSql({ grant: { tableLevel: false, columns: [] } }),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('has NO update at all on design_engagements');
  });
});
