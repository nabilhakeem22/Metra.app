import { describe, expect, it, vi } from 'vitest';
import type { MetraDb } from '@metra/db';
import { ActionError } from './result';
import { requireInOrg } from './mutate';

vi.mock('server-only', () => ({}));

// requireInOrg replaces thirty-six hand-written copies of
//   `const [row] = await tx.select(...)...; if (!row) fail(code);`
// The `if (!row)` line is the load-bearing one: inside an RLS transaction a row
// belonging to another tenant is INVISIBLE to the SELECT, so "no row" is how a
// forged cross-tenant id arrives, and forgetting the check turns a coded refusal
// into a 500 on `row.state` of undefined. These cases pin the contract against a
// stubbed tx; require-in-org.dbtest.ts proves the tenancy half against Postgres.

/** A tx that records the query it was asked to build and answers with `rows`. */
function stubTx(rows: unknown[]) {
  const seen: { columns?: unknown; table?: unknown; where?: unknown; limit?: number } = {};
  const chain = {
    select(columns: unknown) {
      seen.columns = columns;
      return chain;
    },
    from(table: unknown) {
      seen.table = table;
      return chain;
    },
    where(predicate: unknown) {
      seen.where = predicate;
      return chain;
    },
    limit(n: number) {
      seen.limit = n;
      return Promise.resolve(rows);
    },
  };
  return { tx: chain as unknown as MetraDb, seen };
}

const table = { id: { name: 'id' } } as never;
const columns = { id: { name: 'id' }, state: { name: 'state' } } as never;

describe('requireInOrg', () => {
  it('returns the row the caller asked for', async () => {
    const { tx } = stubTx([{ id: 'e1', state: 'negotiation' }]);
    await expect(requireInOrg(tx, table, 'e1', columns, 'engagement_not_found')).resolves.toEqual(
      { id: 'e1', state: 'negotiation' },
    );
  });

  it('fails with the CALLER-CHOSEN code when the row is not visible', async () => {
    // Not visible covers both "does not exist" and "belongs to another org" —
    // inside the RLS tx those are the same answer, and both must be coded.
    const { tx } = stubTx([]);
    await expect(
      requireInOrg(tx, table, 'e1', columns, 'engagement_not_found'),
    ).rejects.toBeInstanceOf(ActionError);
    await expect(
      requireInOrg(tx, table, 'e1', columns, 'boq_not_found'),
    ).rejects.toMatchObject({ code: 'boq_not_found' });
  });

  it('throws rather than returning undefined, so no caller can read through it', async () => {
    // The whole hazard of the hand-written form was `row.state` on undefined.
    const { tx } = stubTx([]);
    let returned: unknown = 'not assigned';
    try {
      returned = await requireInOrg(tx, table, 'e1', columns, 'engagement_not_found');
    } catch {
      /* expected */
    }
    expect(returned).toBe('not assigned');
  });

  it('selects exactly the caller"s columns and limits to one row', async () => {
    const { tx, seen } = stubTx([{ id: 'e1', state: 'negotiation' }]);
    await requireInOrg(tx, table, 'e1', columns, 'engagement_not_found');
    expect(seen.columns).toBe(columns);
    expect(seen.table).toBe(table);
    expect(seen.limit).toBe(1);
    // And it filters — an unfiltered read inside an RLS tx would return the
    // first row of the tenant's whole table and pass the !row check.
    expect(seen.where).toBeDefined();
  });

  it('carries no org predicate — the RLS transaction IS the boundary', async () => {
    // Deliberate: adding `eq(table.orgId, ctx.orgId)` here would imply the helper
    // is what enforces tenancy, and a table without an orgId column would then
    // look like an oversight rather than a table the tx already scopes.
    const { tx, seen } = stubTx([{ id: 'e1', state: 'x' }]);
    await requireInOrg(tx, table, 'e1', columns, 'engagement_not_found');
    expect(JSON.stringify(seen.where ?? {})).not.toContain('org_id');
  });
});
