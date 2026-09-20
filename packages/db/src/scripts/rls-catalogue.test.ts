import { describe, expect, it } from 'vitest';
import { RLS_APPLY_ORDER } from '../rls/manifest';
import {
  declaredFunctions,
  declaredPolicies,
  declaredTriggers,
  functionsIn,
  policiesIn,
  triggersIn,
} from './rls-catalogue';

// These three parsers are what `apply-rls`'s post-apply verification compares
// the database against, so a regex that quietly stops matching turns the gate
// into a green no-op — the exact failure class this wave is about. They are
// therefore pinned TWICE: on hand-written FIXTURES that carry every shape the
// real files use plus the shapes that must NOT match, and on the real manifest
// with exact counts.

describe('policiesIn', () => {
  it('keys by table, because 45 of the 46 policies share one name', () => {
    expect(
      policiesIn(
        'create policy org_isolation on public.clients\n  using (true);\n' +
          'create policy org_isolation on public.boqs using (true);\n' +
          'create policy account_isolation on public.accounts using (true);',
      ),
    ).toEqual(['clients.org_isolation', 'boqs.org_isolation', 'accounts.account_isolation']);
  });

  it('ignores the `drop policy if exists` that makes each file idempotent', () => {
    // Counting drops would double every policy and, worse, would report the one
    // legacy drop with no matching create (`self_memberships`) as declared.
    expect(
      policiesIn(
        'drop policy if exists org_isolation on public.clients;\n' +
          'drop policy if exists self_memberships on public.memberships;\n' +
          'create policy org_isolation on public.clients using (true);',
      ),
    ).toEqual(['clients.org_isolation']);
  });

  it('is case-insensitive and tolerates extra whitespace', () => {
    expect(policiesIn('CREATE   POLICY  org_isolation   ON   public.clients')).toEqual([
      'clients.org_isolation',
    ]);
  });
});

describe('triggersIn', () => {
  it('crosses the newline to the table, for all three timing forms in the tree', () => {
    expect(
      triggersIn(
        'create trigger trg_boqs_immutable\n' +
          '  before update or delete on public.boqs\n' +
          '  for each row execute function public.enforce_immutable_when(...);\n' +
          'create trigger trg_boq_lines_parent_draft\n' +
          '  before insert or update or delete on public.boq_lines\n' +
          '  for each row execute function public.enforce_boq_child_draft();\n' +
          'create trigger trg_x after insert on public.audit_log for each row execute function f();',
      ),
    ).toEqual([
      'boqs.trg_boqs_immutable',
      'boq_lines.trg_boq_lines_parent_draft',
      'audit_log.trg_x',
    ]);
  });

  it('ignores `drop trigger if exists`', () => {
    expect(triggersIn('drop trigger if exists trg_boqs_immutable on public.boqs;')).toEqual([]);
  });

  it('does not let `or` inside the event list be read as the `on` keyword', () => {
    // `before insert or update or delete on public.<t>` — the non-greedy hop
    // must land on the real `on`, not on a fragment of `or`.
    expect(
      triggersIn('create trigger t\n  before insert or update or delete on public.boq_sections\n'),
    ).toEqual(['boq_sections.t']);
  });
});

describe('functionsIn', () => {
  it('matches `create or replace function public.<name>` only', () => {
    expect(
      functionsIn(
        'create or replace function public.app_is_current_org_member()\n' +
          'drop function if exists public.app_claim_invitation(uuid);\n' +
          'CREATE OR REPLACE FUNCTION public.enforce_boq_child_draft()',
      ),
    ).toEqual(['app_is_current_org_member', 'enforce_boq_child_draft']);
  });
});

describe('what the real manifest declares', () => {
  it('finds 46 policies, 12 triggers and 30 functions', () => {
    // A guard on the guards: if a parser breaks, these numbers move and the
    // post-apply verification would otherwise silently check nothing.
    //
    // These are a FLOOR to be raised with every addition, not a fact about the
    // parser. `withoutSqlComments` does not know what a string literal is, so a
    // declaration written with a `--` or `/*` inside one is eaten — and being
    // eaten drops it out of the DECLARED side of a one-directional comparison,
    // which is a false GREEN, not the false red that block used to claim
    // (wave 7 S5). An EXISTING declaration that starts being eaten reds here; a
    // NEW one eaten on the day it is written does not, because the count stays
    // where it was.
    expect(declaredPolicies().size).toBe(46);
    expect(declaredTriggers().size).toBe(12);
    expect(declaredFunctions().size).toBe(30);
  });

  it('names objects this squad can point at, in the file that creates them', () => {
    expect(declaredPolicies().get('accounts.account_isolation')).toBe('policies/00-core.sql');
    expect(declaredTriggers().get('boqs.trg_boqs_immutable')).toBe(
      'policies/30-contracts-boqs-variations.sql',
    );
    expect(declaredFunctions().get('enforce_immutable_when')).toBe('immutability.sql');
    expect(declaredFunctions().get('enforce_boq_child_draft')).toBe(
      'functions/30-contracts-variations.sql',
    );
  });

  it('attributes every object to a file the manifest actually applies', () => {
    for (const declared of [declaredPolicies(), declaredTriggers(), declaredFunctions()]) {
      for (const file of declared.values()) {
        expect(RLS_APPLY_ORDER as readonly string[]).toContain(file);
      }
    }
  });

  it('gives all 12 triggers a real table, never a name swallowed by the hop', () => {
    for (const key of declaredTriggers().keys()) {
      const [table, name] = key.split('.');
      expect(table).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(name).toMatch(/^trg_[a-z0-9_]+$/);
    }
  });
});

// The re-test proved the first version of these parsers could mis-pair a
// trigger with the WRONG table or declare a commented-out object as real —
// and `apply-rls` turns either into a refused deploy on a correct database.
// Every shape below was an executed evasion; each now pins the fix.
describe('the parsers read SQL the way Postgres does', () => {
  it('ignores a comment between the timing keyword and the table', () => {
    expect(
      triggersIn(
        'create trigger trg_a\n' +
          '  before update -- fires on every save, on purpose\n' +
          '  on public.boqs for each row execute function f();\n' +
          'create trigger trg_b after insert on public.contracts for each row execute function f();',
      ),
    ).toEqual(['boqs.trg_a', 'contracts.trg_b']);
  });

  it('accepts a schema-less table without swallowing the next statement', () => {
    expect(
      triggersIn(
        'create trigger trg_a before update on boqs for each row execute function f();\n' +
          'create trigger trg_b before delete on public.contracts for each row execute function f();',
      ),
    ).toEqual(['boqs.trg_a', 'contracts.trg_b']);
    expect(policiesIn('create policy p on boqs using (true);')).toEqual(['boqs.p']);
  });

  it('declares nothing for a commented-out create', () => {
    expect(
      policiesIn('-- create policy old_one on public.clients using (true);\n/* create policy gone on public.boqs using (true); */'),
    ).toEqual([]);
    expect(functionsIn('-- create or replace function public.retired() ...')).toEqual([]);
  });

  it('folds unquoted identifiers to lower case, keeps quoted spelling', () => {
    expect(policiesIn('CREATE POLICY ORG_ISOLATION ON PUBLIC.CLIENTS USING (true);')).toEqual([
      'clients.org_isolation',
    ]);
    expect(policiesIn('create policy "MixedCase" on public."Odd_Table" using (true);')).toEqual([
      'Odd_Table.MixedCase',
    ]);
  });

  it('sees constraint triggers, `or replace` triggers and `or replace`-less functions', () => {
    expect(
      triggersIn(
        'create constraint trigger trg_c after insert on public.audit_log deferrable for each row execute function f();\n' +
          'create or replace trigger trg_d before update on public.boqs for each row execute function f();',
      ),
    ).toEqual(['audit_log.trg_c', 'boqs.trg_d']);
    expect(functionsIn('create function public.plain() returns void language sql as $$ select 1 $$;')).toEqual([
      'plain',
    ]);
  });

  it('is not fooled by a `when` clause that contains the word on', () => {
    expect(
      triggersIn(
        'create trigger trg_w before update on public.boqs\n' +
          '  for each row when (old.status is distinct from new.status) -- only on a change\n' +
          '  execute function f();',
      ),
    ).toEqual(['boqs.trg_w']);
  });
});
