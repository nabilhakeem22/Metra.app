import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs rule module has no types
import rule from '../../../../eslint-rules/no-bare-tenant-db.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as never,
    parserOptions: {
      ecmaFeatures: { jsx: true },
      sourceType: 'module',
    },
  },
});

it('no-bare-tenant-db: flags raw-connection queries, allows scoped ones', () => {
  ruleTester.run('no-bare-tenant-db', rule as never, {
    valid: [
      // RLS-scoped handle from withOrgContext — the sanctioned path.
      {
        code: 'withOrgContext(ctx, (tx) => tx.select().from(clients));',
      },
      {
        code: 'withUserContext(userId, (tx) => tx.execute(sql`select 1`));',
      },
      // A helper receiving an already-scoped `tx` — not the raw handle.
      {
        code: 'function ownerCount(tx) { return tx.select().from(memberships); }',
      },
      // `.delete`/`.update` on non-connection objects must not be flagged.
      { code: 'const cookieStore = cookies(); cookieStore.delete(NAME);' },
      { code: 'store.delete(ctx);' },
      { code: 'map.update(key);' },
      // `.transaction` itself is not a query method.
      { code: 'withRequestDb((db) => db.transaction(async (tx) => run(tx)));' },
      // Allowlisted sanctioned exception — raw db.execute permitted.
      {
        filename: 'apps/web/src/lib/proposals/public.ts',
        code: 'withRequestDb((db) => db.execute(sql`select public.app_proposal_by_token(${h})`));',
      },
      // Allowlisted automation system read.
      {
        filename: 'apps/web/src/lib/automation/system-context.ts',
        code: 'withRequestDb((db) => db.select().from(memberships));',
      },
      // Allowlisted isolation test dir.
      {
        filename: 'tests/isolation/shared-pool.test.ts',
        code: 'const rows = await db.execute(sql`select current_user`);',
      },
    ],
    invalid: [
      // Bare read on the withRequestDb callback param, non-allowlisted file.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'withRequestDb((db) => db.select().from(clients));',
        errors: [{ messageId: 'bareQuery' }],
      },
      // Convention: an identifier named `db` is the raw handle.
      {
        code: 'db.select().from(clients);',
        errors: [{ messageId: 'bareQuery' }],
      },
      // getDb() handle queried directly.
      {
        code: 'const rows = await getDb().insert(clients).values(v);',
        errors: [{ messageId: 'bareQuery' }],
      },
      // Destructured raw handle.
      {
        code: 'const { db } = getRequestConnection(); await db.delete(clients);',
        errors: [{ messageId: 'bareQuery' }],
      },
      // Raw-ness propagates through `.transaction`.
      {
        code: 'withRequestDb((db) => db.transaction((tx) => tx.update(clients).set(x)));',
        errors: [{ messageId: 'bareQuery' }],
      },
      // Multiline shape (the real automation code shape) — AST-based, not regex.
      {
        filename: 'apps/web/src/lib/anything/leak.ts',
        code: 'withRequestDb((db) =>\n  db\n    .select()\n    .from(clients));',
        errors: [{ messageId: 'bareQuery' }],
      },
    ],
  });
});
