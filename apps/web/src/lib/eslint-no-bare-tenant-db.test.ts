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
      // requireInOrg on the scoped tx IS the sanctioned shape — 36 sites do this.
      {
        code: "withOrgContext(ctx, (tx) => requireInOrg(tx, boqs, id, cols, 'boq_not_found'));",
      },
      // ...and a helper that is not in RAW_SENSITIVE_HELPERS is not the rule's business.
      { code: 'withRequestDb((db) => logHandle(db));' },
      // `.delete`/`.update` on non-connection objects must not be flagged.
      { code: 'const cookieStore = cookies(); cookieStore.delete(NAME);' },
      { code: 'store.delete(ctx);' },
      { code: 'map.update(key);' },
      // `.transaction` itself is not a query method.
      { code: 'withRequestDb((db) => db.transaction(async (tx) => run(tx)));' },
      // Drizzle's own `sql` tag is imported in ~200 files and is NOT a
      // connection: only a `sql` that resolves to a raw factory is flagged.
      {
        code: "import { sql } from 'drizzle-orm'; withOrgContext(ctx, (tx) => tx.execute(sql`select 1`));",
      },
      {
        code: "import { sql } from 'drizzle-orm'; function f(tx) { return tx.select().from(c).where(sql`a = 1`); }",
      },
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
      // A GENUINELY DYNAMIC key is a stated KNOWN LIMIT, not an oversight: a
      // syntax rule cannot resolve `conn[key]`, and pretending otherwise would
      // mean guessing. It also takes deliberate effort to write, which is not
      // the shape of the mistake this rule exists to catch; the cross-tenant
      // isolation gate is the backstop.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const conn = getRequestConnection(); await conn[key]`select 1`;',
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'getDb()[method]();',
      },
    ],
    invalid: [
      // THREE MORE EVASIONS, closed in wave 2. Each runs exactly the same
      // BYPASSRLS query as a form the rule already caught, and differs only in
      // punctuation — which is precisely what a rule reading syntax must not be
      // fooled by.
      {
        // A computed key written as an interpolation-free template literal.
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const conn = getRequestConnection(); await conn[`sql`]`select 1`;',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        // A rest binding holds every key the factory returned, handles included.
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const { ...rest } = getRequestConnection(); await rest.sql`select 1`;',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        // A query method reached by computed string.
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "getDb()['select']();",
        errors: [{ messageId: 'bareQuery' }],
      },
      // The postgres.js handle IS the same privileged socket as `db`: reaching
      // for `sql`/`pg` instead of `db` used to bypass this rule entirely.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const { sql } = getRequestConnection(); await sql`select * from public.clients`;',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "const { sql } = createRuntimeConnection(); await sql.unsafe('select 1');",
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const { pg } = getRequestConnection(); await pg`select 1`;',
        errors: [{ messageId: 'bareQuery' }],
      },
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
      // THE FIVE EVASIONS the security re-test proved: renaming the handle or
      // reaching it through the connection object used to silence the rule
      // completely, while running exactly the same BYPASSRLS query.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const { sql: raw } = getRequestConnection(); await raw`select * from public.clients`;',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'await (getRequestConnection().sql)`select * from public.clients`;',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const conn = getRequestConnection(); await conn.sql`select 1`;',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "const c = getRequestConnection(); await c['sql']`select 1`;",
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "const { sql: raw } = createRuntimeConnection(); await raw.unsafe('select 1');",
        errors: [{ messageId: 'bareQuery' }],
      },
      // Multiline shape (the real automation code shape) — AST-based, not regex.
      {
        filename: 'apps/web/src/lib/anything/leak.ts',
        code: 'withRequestDb((db) =>\n  db\n    .select()\n    .from(clients));',
        errors: [{ messageId: 'bareQuery' }],
      },
      // S1: the handle handed to a helper rather than queried on. requireInOrg's
      // where is `eq(table.id, id)` and nothing else — the RLS transaction is its
      // whole tenancy boundary — so on the raw handle it resolves an id belonging
      // to ANY tenant, and it compiled and linted clean before this case existed.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "requireInOrg(getDb(), boqs, id, cols, 'boq_not_found');",
        errors: [{ messageId: 'rawHandleArgument' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "withRequestDb((db) => requireInOrg(db, boqs, id, cols, 'boq_not_found'));",
        errors: [{ messageId: 'rawHandleArgument' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "const { db } = getRequestConnection(); requireInOrg(db, boqs, id, c, 'x');",
        errors: [{ messageId: 'rawHandleArgument' }],
      },
      // S2: the read methods QUERY_METHODS did not list. Each is the same
      // BYPASSRLS read as `.select()`, and none is used in the tree today —
      // which is exactly how they came to be missing.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'withRequestDb((db) => db.selectDistinct().from(clients));',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'withRequestDb((db) => db.selectDistinctOn([clients.id]).from(clients));',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const n = await getDb().$count(clients);',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'await getDb().refreshMaterializedView(clientTotals);',
        errors: [{ messageId: 'bareQuery' }],
      },
      // S2: raw-ness propagates through `.with()`/`.$with()` exactly as it does
      // through `.transaction` — a CTE does not scope anything.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'withRequestDb((db) => db.with(cte).select().from(cte));',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const conn = getRequestConnection(); conn.db.$with(cte).select().from(cte);',
        errors: [{ messageId: 'bareQuery' }],
      },
    ],
  });
});
