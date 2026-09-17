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
        filename: 'apps/web/src/lib/share/sdf-call.ts',
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
      // O6a: an alias inherits what it was initialised FROM, so a scoped
      // handle stays scoped through one. `tx` is a free parameter here
      // ('unknown' - the caller owns the scoping), and 'unknown' must not
      // become 'raw' just because it passed through a const.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'function f(tx) { const q = tx; return q.select().from(clients); }',
      },
      // O6b: the relational api on an RLS-SCOPED handle is the sanctioned
      // shape and must stay silent. (A handle literally named `db` is raw by
      // this rule's name convention whatever its binding - that convention is
      // deliberate and predates this change - so the scoped case is written the
      // way the codebase writes it, as `tx`.)
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'function f(tx) { return tx.query.clients.findMany(); }',
      },
      // O6a, the cycle guard, asserted so a future change to the alias hop
      // cannot turn it into a stack overflow: `let a = b; let b = a;` resolves
      // to 'unknown' and reports NOTHING.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'let a = b; let b = a; a.select().from(clients);',
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
      // THE SECOND FENCE, allowed side: the token portals are the reason
      // sdf-call.ts exists. Each passes a token HASH to a SECURITY DEFINER
      // function that omits every cost/margin column.
      {
        filename: 'apps/web/src/lib/proposals/public.ts',
        code: "import { readSdfJson } from '@/lib/share/sdf-call';\nreadSdfJson(query);",
      },
      {
        filename: 'apps/web/src/lib/engagements/public/delivery.ts',
        code: "import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';\nreadSdfJson(q);",
      },
      {
        filename: 'apps/web/src/lib/engagements/public-comments.ts',
        code: "import { readSdfCode } from '@/lib/share/sdf-call';\nreadSdfCode(q);",
      },
      // The module's own unit test imports it relatively.
      {
        filename: 'apps/web/src/lib/share/sdf-call.test.ts',
        code: "import { readSdfJson } from './sdf-call';\nreadSdfJson(q);",
      },
      // An allowlisted portal may reach the module by ANY of the six forms.
      {
        filename: 'apps/web/src/lib/proposals/public.ts',
        code: "const m = require('@/lib/share/sdf-call');\n",
      },
      // A `require` of anything else is not this rule's business, and neither is
      // a local function that merely shares the name (the W3-3 false positive).
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "const fs = require('node:fs');\nconst q = require(somePath);",
      },
      // A property that merely SHARES a runner's name is not a reference to it.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const shape = { readSdfJson: 1 }; use(shape.readSdfJson);',
      },
      // W3-3, CLOSED BY CONSTRUCTION: a LOCAL function that happens to be called
      // `readSdfJson` reaches nothing. The fence judges the module a file
      // depends on, so a name that names nothing outside this file is not a
      // dependency and is not reported.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code:
          'function readSdfJson(query) {\n' +
          '  return localCache.get(query);\n' +
          '}\n' +
          'export const rows = readSdfJson("clients");\n',
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
        errors: [{ messageId: 'bareTaggedSqlQuery' }],
      },
      {
        // A rest binding holds every key the factory returned, handles included.
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const { ...rest } = getRequestConnection(); await rest.sql`select 1`;',
        errors: [{ messageId: 'bareTaggedSqlQuery' }],
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
        errors: [{ messageId: 'bareTaggedSqlQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "const { sql } = createRuntimeConnection(); await sql.unsafe('select 1');",
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const { pg } = getRequestConnection(); await pg`select 1`;',
        errors: [{ messageId: 'bareTaggedSqlQuery' }],
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
        errors: [{ messageId: 'bareTaggedSqlQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'await (getRequestConnection().sql)`select * from public.clients`;',
        errors: [{ messageId: 'bareTaggedSqlQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const conn = getRequestConnection(); await conn.sql`select 1`;',
        errors: [{ messageId: 'bareTaggedSqlQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "const c = getRequestConnection(); await c['sql']`select 1`;",
        errors: [{ messageId: 'bareTaggedSqlQuery' }],
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
      // O6a: the one-level alias. `const q = db` is what a developer writes to
      // shorten a line, and before this it silenced the rule completely while
      // running exactly the same BYPASSRLS query.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const q = db; await q.select().from(clients);',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'const { db } = getRequestConnection(); const q = db; await q.execute(stmt);',
        errors: [{ messageId: 'bareQuery' }],
      },
      // O6b: drizzle's RELATIONAL api. `db.query.clients.findMany()` is the
      // documented read surface and the most likely shape of the next
      // org-scoped read; QUERY_METHODS listed neither method and isRawExpr did
      // not follow the `.query` hop, so both linted clean.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'await db.query.clients.findMany();',
        errors: [{ messageId: 'bareQuery' }],
      },
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: 'await db.query.clients.findFirst({ where: eq(clients.id, id) });',
        errors: [{ messageId: 'bareQuery' }],
      },
      // S1: THE SECOND FENCE. Concentrating nine allowlisted files into one moved
      // the exemption but not the enforcement — a security review wrote this exact
      // file in lib/clients, ran eslint, and got exit 0. ONE report now, at the
      // specifier: the DEPENDENCY is the violation. Reporting the call site as
      // well said the same thing twice, and the name-based check that produced
      // the second report also fired on any local function that merely shared
      // the name (W3-3).
      {
        filename: 'apps/web/src/lib/clients/secprobe-sdf.ts',
        code: "import { readSdfJson } from '@/lib/share/sdf-call';\nawait readSdfJson(sql`select * from public.clients`);",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // The RELATIVE spelling resolves to the same module — the evasion that
      // defeated the sibling module-shape gate.
      {
        filename: 'apps/web/src/lib/clients/secprobe-sdf.ts',
        code: "import { readSdfCode } from '../share/sdf-call';\n",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // Importing only the token normaliser still names the fenced module: the
      // whole file is the exemption surface, not one of its exports.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "import { normalizeRawToken } from '@/lib/share/sdf-call';\n",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // A DYNAMIC import of the fenced module, with the runner reached by a
      // property call on the resolved namespace. The specifier is a literal, so
      // the rule resolves it and reports at the specifier.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code:
          "const rows = await import('@/lib/share/sdf-call').then((m) => m.readSdfJson(q));\n",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // A RE-EXPORT is a dependency. Reporting it here is what closes the
      // aliased-barrel evasion at its source: a barrel cannot launder the runner
      // to consumers under a legal-looking path, because the barrel itself is
      // the violation.
      {
        filename: 'apps/web/src/lib/clients/barrel.ts',
        code: "export { readSdfJson } from '@/lib/share/sdf-call';\n",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // `export * from` forwards it without even naming it.
      {
        filename: 'apps/web/src/lib/clients/barrel.ts',
        code: "export * from '@/lib/share/sdf-call';\n",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // An ALIASED import, spelled relatively and with the extension — the module
      // is recognised by its TAIL, not by one spelling of its path.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "import { readSdfJson as runner } from '../share/sdf-call.ts';\nrunner(q);",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // A bare SIDE-EFFECT import still makes this file depend on the module.
      {
        filename: 'apps/web/src/lib/clients/queries.ts',
        code: "import '@/lib/share/sdf-call';\n",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // A file allowlisted to open the raw socket itself has no standing to run
      // somebody ELSE's token SDF: the two allowlists sanction different things.
      {
        filename: 'apps/web/src/lib/automation/runner.ts',
        code: "import { readSdfJson } from '@/lib/share/sdf-call';\n",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // S1/F3: `require('…')`. The sibling gate's `ts.preProcessFile` scanner
      // DOES return a specifier for this shape, so a fence that did not see it
      // made "one rule, two hosts" false. Belt-and-braces in apps/web —
      // `@typescript-eslint/no-require-imports` is error repo-wide — but the
      // fence must not depend on another rule staying switched on.
      {
        filename: 'apps/web/src/lib/clients/secprobe-sdf.ts',
        code: "const m = require('@/lib/share/sdf-call');\nm.readSdfJson(q);",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // …spelled relatively, with the extension, and with a template literal
      // instead of quotes: one module, three punctuations.
      {
        filename: 'apps/web/src/lib/clients/secprobe-sdf.ts',
        code: "const m = require(`../share/sdf-call.ts`);\n",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // `import x = require('…')` — TypeScript's own form, a different AST node.
      {
        filename: 'apps/web/src/lib/clients/secprobe-sdf.ts',
        code: "import runner = require('@/lib/share/sdf-call');\nrunner.readSdfCode(q);",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
      // A file allowlisted for the BASE connection takes the early return, which
      // hands back the SDF visitors alone — the require branch must survive it.
      {
        filename: 'apps/web/src/lib/automation/runner.ts',
        code: "const m = require('@/lib/share/sdf-call');\n",
        errors: [{ messageId: 'sdfCallerNotAllowlisted' }],
      },
    ],
  });
});
