import { describe, expect, it } from 'vitest';
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
