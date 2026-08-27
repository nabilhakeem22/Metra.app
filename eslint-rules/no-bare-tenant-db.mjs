// ESLint rule: forbid a Drizzle query (`.select`/`.insert`/`.update`/`.delete`/
// `.execute`) on the RAW request/base DB connection.
//
// WHY: `apps/web/src/lib/db/{client,request-connection}.ts` concentrate ONE
// privileged postgres.js handle that every caller borrows via `withRequestDb`.
// That handle logs in as the base role (BYPASSRLS), so a query issued directly on
// it runs with NO row-level-security backstop and silently reads/writes across
// EVERY tenant. Tenant isolation on business tables depends on developers ALWAYS
// reaching org-scoped data through `withOrgContext()` / `withUserContext()`, which
// open a transaction and `set local role metra_app` (NOBYPASSRLS) so the RLS
// policies are enforced. A bare `db.select(...).from(clients)` is a cross-tenant
// data leak that no test necessarily catches — this rule turns it into a lint
// error at author time.
//
// WHAT COUNTS AS THE RAW HANDLE — recognised however it is obtained:
//   • the parameter of a `withRequestDb((db) => …)` callback;
//   • the value of `getDb()`, or a `{ db } = getRequestConnection()` /
//     `{ db } = createRuntimeConnection()` / `createRuntimeConnection().db`
//     destructure/access;
//   • the transaction handle of `<raw>.transaction((tx) => …)` — still un-scoped,
//     because no role/GUC has been set yet — which is why raw-ness PROPAGATES
//     through `.transaction`;
//   • by the pervasive convention of this codebase, any identifier literally
//     named `db` (the raw handle is `db` everywhere; the RLS-scoped handle is `tx`).
// A handle bound by `withOrgContext` / `withUserContext` (conventionally `tx`) is
// SAFE and never flagged. A free `tx: MetraDb` helper parameter (the dozens of
// `core.ts`/`queries.ts` helpers that receive an already-scoped tx) is treated as
// unknown — the caller is responsible for passing a scoped tx — and is not flagged.
// `.transaction()` itself is NOT a query method: opening a transaction is not a
// cross-tenant read, so the receiver of `.transaction` is never reported; only the
// `.select/.insert/.update/.delete/.execute` that follows is.
//
// SANCTIONED EXCEPTIONS — allowlisted files that deliberately use the base
// connection and have each been individually reviewed as safe:
//   1. Public token-hash SECURITY DEFINER calls — the opaque token IS the auth,
//      and the SDF omits every cost/margin column, so nothing can leak the firm's
//      cost or another tenant's data:
//        apps/web/src/lib/proposals/public.ts
//        apps/web/src/lib/contracts/public.ts
//        apps/web/src/lib/engagements/public.ts
//        apps/web/src/lib/variations/public.ts
//   2. The public API-key resolver, which wraps its SDF in a transaction and drops
//      into `set local role metra_app` before the call:
//        apps/web/src/lib/api-keys/resolve.ts
//   3. The session-less automation actor (a cross-org cron): it reads ONLY system
//      tables (organizations / automation_settings / memberships) to enumerate
//      orgs, then performs every business read/write inside a single-org
//      `withOrgContext` RLS transaction keyed on a resolved system actor:
//        apps/web/src/lib/automation/system-context.ts
//        apps/web/src/lib/automation/runner.ts
// Plus the trusted core that DEFINES `withOrgContext` / `withUserContext` itself
// (it is where `set local role metra_app` lives), and the isolation tests that
// probe the raw socket on purpose:
//        packages/db/src/org-context.ts
//        tests/isolation/**
//
// If you are adding a genuinely-new sanctioned base-connection use, add its file
// here WITH a comment justifying why it is safe — do not disable the rule inline.

/** Drizzle query builders that actually touch data. `transaction` is deliberately
 * excluded — it only opens a tx; the risk is the read/write/exec inside it. */
const QUERY_METHODS = new Set(['select', 'insert', 'update', 'delete', 'execute']);

/** Callback wrappers that hand back the RAW (un-scoped) connection. */
const RAW_WRAPPERS = new Set(['withRequestDb']);

/** Callback wrappers that hand back an RLS-scoped transaction handle. */
const SAFE_WRAPPERS = new Set([
  'withOrgContext',
  'withUserContext',
  // The `@metra/db` core primitives, imported under these local names in
  // apps/web/src/lib/db/context.ts.
  'coreWithOrgContext',
  'coreWithUserContext',
]);

/** Functions that mint the raw connection. `getDb()` returns the handle directly;
 * the other two return `{ db, sql }`, so only their `.db` is the handle. */
const RAW_FACTORIES = new Set([
  'getDb',
  'getRequestConnection',
  'createRuntimeConnection',
]);

// Allowlisted files (path suffixes) — the sanctioned base-connection exceptions
// documented above. Matched against the normalised (forward-slash) filename.
const ALLOWLISTED_FILES = [
  'apps/web/src/lib/proposals/public.ts',
  'apps/web/src/lib/contracts/public.ts',
  'apps/web/src/lib/engagements/public.ts',
  'apps/web/src/lib/variations/public.ts',
  'apps/web/src/lib/api-keys/resolve.ts',
  'apps/web/src/lib/automation/system-context.ts',
  'apps/web/src/lib/automation/runner.ts',
  'packages/db/src/org-context.ts',
];

// Allowlisted directories (path fragments) — isolation tests deliberately read on
// the raw socket to prove RLS/isolation behaviour.
const ALLOWLISTED_DIRS = ['tests/isolation/'];

function isAllowlisted(filename) {
  if (!filename) return false;
  const norm = filename.replace(/\\/g, '/');
  if (ALLOWLISTED_FILES.some((f) => norm.endsWith(f))) return true;
  return ALLOWLISTED_DIRS.some((d) => norm.includes(d));
}

/** @type {import('eslint').Rule.RuleModule} */
export const noBareTenantDb = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid Drizzle queries on the raw request/base DB connection (RLS bypass / cross-tenant leak). Use withOrgContext/withUserContext.',
    },
    schema: [],
    messages: {
      bareQuery:
        'Drizzle `.{{method}}()` on the raw request/base connection runs as the BYPASSRLS login role and can read/write across every tenant. Wrap org-scoped access in withOrgContext()/withUserContext(). If this is a sanctioned base-connection use (public token SDF, api-key resolver, automation system read), allowlist the file in eslint-rules/no-bare-tenant-db.mjs.',
    },
  },
  create(context) {
    const filename =
      context.filename ??
      (context.getFilename && context.getFilename()) ??
      '';
    // Whole-file opt-out for the reviewed, sanctioned exceptions.
    if (isAllowlisted(filename)) return {};

    const sourceCode =
      context.sourceCode ??
      (context.getSourceCode && context.getSourceCode());

    // Memoise per-identifier classification; the pre-seeded 'unknown' also breaks
    // any pathological binding cycle during resolution.
    const classifyCache = new Map();

    function resolveVariable(idNode) {
      if (!sourceCode || !sourceCode.getScope) return null;
      let scope = sourceCode.getScope(idNode);
      while (scope) {
        const found = scope.variables.find((v) => v.name === idNode.name);
        if (found) return found;
        scope = scope.upper;
      }
      return null;
    }

    // Is this expression node the raw connection? (Identifier resolved to a raw
    // binding, a `getDb()` call, or a `getRequestConnection()/createRuntimeConnection().db`.)
    function isRawExpr(node) {
      if (!node) return false;
      if (node.type === 'Identifier') {
        return classifyIdentifier(node) === 'raw';
      }
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        RAW_FACTORIES.has(node.callee.name)
      ) {
        // Only getDb() returns the handle itself; the others return `{ db, sql }`.
        return node.callee.name === 'getDb';
      }
      if (
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.property.type === 'Identifier' &&
        node.property.name === 'db' &&
        node.object.type === 'CallExpression' &&
        node.object.callee.type === 'Identifier' &&
        RAW_FACTORIES.has(node.object.callee.name)
      ) {
        // getRequestConnection().db / createRuntimeConnection().db
        return true;
      }
      return false;
    }

    // Classify a variable definition as 'raw' | 'safe' | 'unknown'.
    function classifyDef(def) {
      if (def.type === 'Parameter') {
        const fn = def.node; // Arrow/Function(Expression|Declaration)
        const parent = fn && fn.parent;
        // A callback parameter whose function is an ARGUMENT to a wrapper call.
        if (
          parent &&
          parent.type === 'CallExpression' &&
          parent.arguments.includes(fn)
        ) {
          const callee = parent.callee;
          if (callee.type === 'Identifier') {
            if (RAW_WRAPPERS.has(callee.name)) return 'raw';
            if (SAFE_WRAPPERS.has(callee.name)) return 'safe';
          } else if (
            callee.type === 'MemberExpression' &&
            !callee.computed &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'transaction'
          ) {
            // `<recv>.transaction((tx) => …)`: the tx inherits the receiver's
            // raw-ness — no role/GUC has been set inside the transaction yet.
            return isRawExpr(callee.object) ? 'raw' : 'unknown';
          }
        }
        return 'unknown';
      }
      if (def.type === 'Variable') {
        const decl = def.node; // VariableDeclarator
        const init = decl && decl.init;
        if (isRawFactoryValue(init, def.name)) return 'raw';
        return 'unknown';
      }
      return 'unknown';
    }

    // `const db = getDb()` | `const { db } = getRequestConnection()` |
    // `const x = createRuntimeConnection().db`
    function isRawFactoryValue(init, nameNode) {
      if (!init) return false;
      if (init.type === 'CallExpression' && init.callee.type === 'Identifier') {
        const name = init.callee.name;
        if (name === 'getDb') return true;
        if (name === 'getRequestConnection' || name === 'createRuntimeConnection') {
          // Only the destructured `db` property is the handle (not `sql`).
          return !!nameNode && nameNode.name === 'db';
        }
      }
      if (
        init.type === 'MemberExpression' &&
        !init.computed &&
        init.property.type === 'Identifier' &&
        init.property.name === 'db' &&
        init.object.type === 'CallExpression' &&
        init.object.callee.type === 'Identifier' &&
        RAW_FACTORIES.has(init.object.callee.name)
      ) {
        return true;
      }
      return false;
    }

    function classifyIdentifier(idNode) {
      const cached = classifyCache.get(idNode);
      if (cached !== undefined) return cached;
      classifyCache.set(idNode, 'unknown'); // cycle guard

      let result = 'unknown';
      const variable = resolveVariable(idNode);
      if (variable) {
        for (const def of variable.defs) {
          const c = classifyDef(def);
          if (c !== 'unknown') {
            result = c;
            break;
          }
        }
      }
      // Convention fallback: the raw handle is named `db` throughout the codebase,
      // and no safe (RLS-scoped) handle is ever named `db`. This also catches a
      // planted `db.select(...)` whose binding the scope walk can't reach.
      if (result === 'unknown' && idNode.name === 'db') result = 'raw';

      classifyCache.set(idNode, result);
      return result;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier'
        ) {
          return;
        }
        const method = callee.property.name;
        if (!QUERY_METHODS.has(method)) return;
        if (!isRawExpr(callee.object)) return;
        context.report({
          node: callee.property,
          messageId: 'bareQuery',
          data: { method },
        });
      },
    };
  },
};

export default noBareTenantDb;
