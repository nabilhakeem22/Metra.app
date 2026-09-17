// ESLint rule: forbid a query on the RAW request/base DB connection — either a
// Drizzle builder (`.select`/`.insert`/`.update`/`.delete`/`.execute`) or the
// underlying postgres.js handle (a `` sql`…` `` tagged template, or
// `.unsafe(…)`).
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
// THE postgres.js HANDLE COUNTS TOO. `getRequestConnection()` /
// `createRuntimeConnection()` return `{ db, sql, pg }`: `db` is the Drizzle
// wrapper and `sql`/`pg` are the SAME privileged socket underneath it. Reaching
// for `sql` instead of `db` was therefore a complete bypass of this rule while
// being exactly as dangerous, so a destructured `sql`/`pg` from those factories is
// raw, and both `` sql`select …` `` and `sql.unsafe(…)` on it are reported.
// NEITHER RENAMING NOR DOTTING HIDES IT: the handle is known by the PROPERTY it
// came from, not the local name, and the connection object is tracked too — so
// `{ sql: raw }`, `conn.sql`, `conn['sql']` and `getRequestConnection().sql` count.
// KNOWN LIMITS (deliberate): raw-ness survives neither a return from a local helper
// nor an assignment into an outer `let`; a COMPUTED key that is not a literal or
// an interpolation-free template (`conn[key]`, `getDb()[method]()`) cannot be
// resolved statically at all. Four more are RuleTester-proven and left open on
// purpose — `Reflect.get(conn, 'sql')`, `Object.values(getRequestConnection())[1]`,
// a class FIELD holding the handle, an array destructure of a connection: this
// rule reads syntax, and a value that has been through a reflective read or an
// index is no longer syntax. Each takes deliberate effort to write — not the
// shape of the mistake this exists to catch — and the isolation gate backstops them.
// Deliberately NOT extended by name convention: drizzle's own `sql` tag is
// imported in roughly two hundred files and is not a connection, so only a `sql`
// that RESOLVES to a raw factory is flagged. `db` keeps its name convention.
//
// A handle bound by `withOrgContext` / `withUserContext` (conventionally `tx`) is
// SAFE and never flagged. A free `tx: MetraDb` helper parameter (the dozens of
// `core.ts`/`queries.ts` helpers that receive an already-scoped tx) is treated as
// unknown — the caller is responsible for passing a scoped tx — and is not flagged.
// `.transaction()` itself is NOT a query method: opening a transaction is not a
// cross-tenant read, so the receiver of `.transaction` is never reported; only the
// `.select/.insert/.update/.delete/.execute` that follows is. `.with()`/`.$with()`
// hand back the SAME un-scoped connection, so raw-ness PROPAGATES through them.
// A HELPER THAT TAKES THE HANDLE IS THE OTHER HALF: `requireInOrg(tx, …)` filters
// on the id ALONE — the RLS transaction is its whole tenancy boundary — so the
// raw handle is reported wherever it is passed as the first argument of a
// RAW_SENSITIVE_HELPERS name, not only where a query method is called on it.
//
// SANCTIONED EXCEPTIONS — allowlisted files that deliberately use the base
// connection and have each been individually reviewed as safe:
//   1. Public token-hash SECURITY DEFINER calls — the opaque token IS the auth,
//      and the SDF omits every cost/margin column, so nothing can leak the firm's
//      cost or another tenant's data. There is now ONE file for all of them; every
//      portal (proposals, contracts, variations, and the four delivery-portal
//      files) runs its SDF through it and contains no `withRequestDb`,
//      no `.execute(`, no `.unsafe(` of its own:
//        apps/web/src/lib/share/sdf-call.ts — readSdfJson / readSdfCode, which
//          execute a caller-built SQL object and read one column off row 0.
//          Nothing is interpolated; there is no string-concatenation path, and the
//          file has no other reason to exist, so an unrelated base-connection
//          query added here would be conspicuous in review.
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
//
// THE SECOND FENCE — WHO MAY REACH sdf-call.ts. Concentrating nine allowlisted
// files into one moved the exemption but not the ENFORCEMENT: `import
// { readSdfJson } from '@/lib/share/sdf-call'` plus any built SQL object then ran
// on the BYPASSRLS socket from anywhere under apps/web/src, with no lint error,
// no allowlist entry and no review signal. A security review wrote exactly that
// file, ran eslint on it, and got exit 0. So DEPENDING on that module is itself
// fenced, to the token portals that legitimately need it — see
// SDF_CALLER_ALLOWLIST below. `sdf-call.ts` additionally asserts at RUNTIME that
// the statement it is handed is a `select public.app_*(…)`, so both halves of
// "this socket only ever runs token SDFs" are enforced rather than documented.
//
// WHAT IT COVERS, exactly — the seven source forms that name a module, across
// six visitors, each with a RuleTester case:
//        `import … from '…'`            ImportDeclaration
//        `import '…'` (side effect)     ImportDeclaration
//        `export { … } from '…'`        ExportNamedDeclaration
//        `export * from '…'`            ExportAllDeclaration
//        `import('…')`                  ImportExpression
//        `import x = require('…')`      TSImportEqualsDeclaration
//        `require('…')`                 CallExpression
// The last two are covered because the SIBLING gate covers them: the
// `ts.preProcessFile` scanner in `apps/web/src/lib/module-shape.test.ts` returns
// a specifier for both `require` shapes, and "one rule, two hosts" is only true
// if both hosts see the same shapes. They are belt-and-braces in apps/web —
// `@typescript-eslint/no-require-imports` is error repo-wide (eslint.config.mjs)
// and the Worker bundle is ESM — but the fence should not depend on another
// rule staying switched on. The specifier may be a string literal or an
// interpolation-free template in every form. The rule judges the RESOLVED
// MODULE and reports at the specifier, so a file that RE-EXPORTS a runner is
// reported at its own `export … from` and its consumers cannot reach the runner
// by a legal path.
//
// WHAT IT CANNOT COVER, stated exactly rather than implied. Two shapes, both
// demonstrated against this rule and both returning zero messages:
//        `import(`@/lib/share/sdf-${part}`)`   an interpolated template
//        `import(modulePath)`                  an identifier
//        `createRequire(import.meta.url)(…)`   a require obtained as a value
// The sibling `ts.preProcessFile` scanner returns [] for them too, so neither
// host sees a computed specifier; no such call site exists today (the only
// importers are the seven allowlisted portals). Also out of reach: a reflective
// read (`globalThis[name]`) and a runner handed across a module boundary as a
// VALUE. A syntax rule cannot see any of these, and the previous version's
// attempt to — reporting every IDENTIFIER named `readSdfJson` — bought no real
// coverage and cost a false positive on a local function that merely shared the
// name (W3-3).
//
// WHAT THE RUNTIME BACKSTOP ACTUALLY BUYS, stated precisely because the previous
// wording over-claimed it: `assertTokenSdf` in `sdf-call.ts` constrains the
// STATEMENT, not the CALLER. It refuses anything that is not a
// `select public.app_*(…)`, so a module reached by a computed specifier still
// cannot run `select * from clients` on the BYPASSRLS socket. It does NOT
// establish that the caller was entitled to run a token SDF at all — that half
// is the allowlist above, and the allowlist is a syntax rule.

/** Query methods that actually touch data — Drizzle builders plus postgres.js's
 * `.unsafe`. `transaction` is deliberately excluded: it only opens a tx; the risk
 * is the read/write/exec inside it. */
const QUERY_METHODS = new Set([
  'select',
  // The rest of drizzle's read surface. Unused today, which is why they were
  // missing: a rule listing only what is already written catches only what was reviewed.
  'selectDistinct',
  'selectDistinctOn',
  '$count',
  'refreshMaterializedView',
  'insert',
  'update',
  'delete',
  'execute',
  'unsafe',
]);

/** Builder methods that return the SAME un-scoped connection: `db.with(cte)
 * .select()` is a bare `db.select()` wearing a CTE. (`.transaction` propagates
 * too, via its callback parameter — classifyDef handles that shape.) */
const RAW_PROPAGATING_METHODS = new Set(['with', '$with']);

/** Helpers whose FIRST argument must already be an RLS-scoped transaction: on the raw
 * handle, requireInOrg's id-only where reads the row named `id` in ANY org. */
const RAW_SENSITIVE_HELPERS = new Set(['requireInOrg']);

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
 * the other two return `{ db, sql, pg }`, so their handle KEYS are the handles. */
const RAW_FACTORIES = new Set([
  'getDb',
  'getRequestConnection',
  'createRuntimeConnection',
]);

/** The keys of a `{ db, sql, pg }` connection — all three are the SAME socket. */
const RAW_HANDLE_KEYS = new Set(['db', 'sql', 'pg']);

/** `await getRequestConnection()` classifies exactly like `getRequestConnection()`. */
function unwrapAwait(node) {
  return node && node.type === 'AwaitExpression' ? node.argument : node;
}

/** The factory name this expression calls, or null. */
function rawFactoryName(node) {
  const call = unwrapAwait(node);
  if (!call || call.type !== 'CallExpression') return null;
  if (call.callee.type !== 'Identifier') return null;
  return RAW_FACTORIES.has(call.callee.name) ? call.callee.name : null;
}

/** The key a member access or a pattern property names — dotted, or computed with
 * a string literal so `conn['sql']` is not a hiding place. Null when not static. */
function staticKeyName(computed, key) {
  if (computed) {
    if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
    // `conn[`sql`]` is the same read as `conn.sql`; a template literal with no
    // interpolations is a string constant wearing different punctuation.
    if (key.type === 'TemplateLiteral' && key.expressions.length === 0) {
      return key.quasis.map((quasi) => quasi.value.cooked).join('');
    }
    return null;
  }
  if (key.type === 'Identifier') return key.name;
  return key.type === 'Literal' ? String(key.value) : null;
}

// Allowlisted files (path suffixes) — the sanctioned base-connection exceptions
// documented above. Matched against the normalised (forward-slash) filename.
const ALLOWLISTED_FILES = [
  'apps/web/src/lib/share/sdf-call.ts',
  'apps/web/src/lib/api-keys/resolve.ts',
  'apps/web/src/lib/automation/system-context.ts',
  'apps/web/src/lib/automation/runner.ts',
  'packages/db/src/org-context.ts',
  // The RLS/roles/functions applier itself: it runs the .sql files that CREATE
  // the metra_app role and the policies, so by definition it must execute as the
  // owning login BEFORE any scoped role exists. It reads no business table.
  'packages/db/src/scripts/apply-rls.ts',
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

// The files that may reach `lib/share/sdf-call.ts` — the token portals, each of
// which resolves a share token to its sha256 hash and passes it to a SECURITY
// DEFINER function that omits every cost/margin column. A new entry here means a
// new public surface, which is exactly the diff a reviewer should be shown.
const SDF_CALLER_ALLOWLIST = [
  'apps/web/src/lib/proposals/public.ts',
  'apps/web/src/lib/contracts/public.ts',
  'apps/web/src/lib/variations/public.ts',
  'apps/web/src/lib/engagements/public/delivery.ts',
  'apps/web/src/lib/engagements/public/respond.ts',
  'apps/web/src/lib/engagements/public-documents.ts',
  'apps/web/src/lib/engagements/public-comments.ts',
  // The module itself (it DEFINES the runners) and its own unit test.
  'apps/web/src/lib/share/sdf-call.ts',
  'apps/web/src/lib/share/sdf-call.test.ts',
];

function isSdfCallerAllowlisted(filename) {
  if (!filename) return false;
  const norm = filename.replace(/\\/g, '/');
  return SDF_CALLER_ALLOWLIST.some((f) => norm.endsWith(f));
}

/**
 * Is this import specifier `lib/share/sdf-call`, however it is spelled?
 *
 * The `@/`-aliased form and the relative one resolve to the same module, and a
 * sibling gate was walked through with `../../` in this exact codebase — so the
 * module is recognised by its TAIL, not by one spelling of its path.
 */
function isSdfCallModule(source) {
  return typeof source === 'string' && /(^|\/)sdf-call(\.[jt]s)?$/.test(source);
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
      rawHandleArgument:
        '`{{helper}}()` is given the raw request/base connection. Its where clause carries no org predicate on purpose — the RLS transaction is the tenancy boundary — so on the BYPASSRLS handle it resolves an id belonging to ANY tenant. Pass the `tx` from withOrgContext()/withUserContext().',
      sdfCallerNotAllowlisted:
        '`lib/share/sdf-call` executes its statement on the BYPASSRLS base connection with no org GUCs — the share TOKEN is the only auth. Only the token portals may reach it, and this file is not one of them. Read org-scoped data through withOrgContext()/withUserContext(); if this really is a new public token surface, add the file to SDF_CALLER_ALLOWLIST in eslint-rules/no-bare-tenant-db.mjs with a reason.',
    },
  },
  create(context) {
    const filename =
      context.filename ??
      (context.getFilename && context.getFilename()) ??
      '';

    // The second fence: who may reach the one sanctioned base-connection surface.
    // It is NOT skipped by the base-connection allowlist above — the two lists
    // sanction different things, and a file allowlisted to open the raw socket
    // itself has no standing to run somebody else's token SDF.
    const reportSdfSource = (source) => {
      if (!source || !isSdfCallModule(source.value)) return;
      context.report({ node: source, messageId: 'sdfCallerNotAllowlisted' });
    };

    /**
     * The specifier node of a `require('…')` naming the fenced module, or null.
     * Exported through `reportSdfRequire` rather than inlined because the main
     * visitor set has its OWN `CallExpression` — the spread below would silently
     * drop a second one, which is the kind of quiet hole this fence exists to
     * close.
     */
    const sdfRequireSpecifier = (node) => {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return null;
      const [first] = node.arguments;
      if (!first) return null;
      const specifier = staticKeyName(true, first);
      return specifier !== null && isSdfCallModule(specifier) ? first : null;
    };

    const sdfCallerFenced = !isSdfCallerAllowlisted(filename);

    const reportSdfRequire = (node) => {
      if (!sdfCallerFenced) return;
      const specifier = sdfRequireSpecifier(node);
      if (specifier) context.report({ node: specifier, messageId: 'sdfCallerNotAllowlisted' });
    };

    const sdfCallerVisitors = !sdfCallerFenced
      ? {}
      : {
          // `import … from '…'` AND the bare side-effect `import '…'`: both are
          // ImportDeclarations and both make this file depend on the module.
          ImportDeclaration(node) {
            reportSdfSource(node.source);
          },
          // `export { readSdfJson } from '…'` — a re-export is a dependency, and
          // reporting it HERE is what stops an aliased barrel laundering the
          // runner to consumers that would otherwise import a legal-looking path.
          ExportNamedDeclaration(node) {
            reportSdfSource(node.source);
          },
          // `export * from '…'` — the same, without even naming what it forwards.
          ExportAllDeclaration(node) {
            reportSdfSource(node.source);
          },
          // `await import('…')`, including one whose result is used by a property
          // call. The specifier is an EXPRESSION, so only a literal or an
          // interpolation-free template is resolvable — staticKeyName's exact
          // rule, already in this file. A genuinely computed specifier is out of
          // reach for a syntax rule; see the comment block above.
          ImportExpression(node) {
            const specifier = staticKeyName(true, node.source);
            if (specifier === null || !isSdfCallModule(specifier)) return;
            context.report({ node: node.source, messageId: 'sdfCallerNotAllowlisted' });
          },
          // `import runner = require('…')` — TypeScript's own import form. Its
          // module reference is a TSExternalModuleReference wrapping the literal.
          TSImportEqualsDeclaration(node) {
            const reference = node.moduleReference;
            if (!reference || reference.type !== 'TSExternalModuleReference') return;
            const specifier = staticKeyName(true, reference.expression);
            if (specifier === null || !isSdfCallModule(specifier)) return;
            context.report({ node: reference.expression, messageId: 'sdfCallerNotAllowlisted' });
          },
          // `require('…')` as an expression. Only reached when the file is
          // allowlisted for the BASE connection (the early return below hands
          // back exactly this object); every other file goes through the main
          // CallExpression visitor, which calls the same helper first.
          CallExpression(node) {
            reportSdfRequire(node);
          },
        };

    // Whole-file opt-out for the reviewed, sanctioned exceptions.
    if (isAllowlisted(filename)) return sdfCallerVisitors;

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
    // binding, a `getDb()` call, or ANY handle key read off a connection object —
    // `getRequestConnection().sql`, `conn.pg`, `conn['sql']`.)
    function isRawExpr(node) {
      if (!node) return false;
      if (node.type === 'Identifier') {
        return classifyIdentifier(node) === 'raw';
      }
      const factory = rawFactoryName(node);
      // Only getDb() returns the handle itself; the others return `{ db, sql, pg }`.
      if (factory) return factory === 'getDb';
      if (node.type === 'MemberExpression') {
        // `.sql`/`.pg` are the SAME socket as `.db`: dotting the connection object
        // instead of destructuring it changes nothing.
        const key = staticKeyName(node.computed, node.property);
        if (key === null || !RAW_HANDLE_KEYS.has(key)) return false;
        const object = unwrapAwait(node.object);
        if (rawFactoryName(object)) return true;
        return (
          object.type === 'Identifier' && classifyIdentifier(object) === 'connection'
        );
      }
      // `<raw>.with(cte)` returns the raw connection's own builder, so whatever
      // is queried on the result is queried on the raw connection.
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
        const key = staticKeyName(node.callee.computed, node.callee.property);
        if (key !== null && RAW_PROPAGATING_METHODS.has(key)) return isRawExpr(node.callee.object);
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
        return classifyDeclarator(def.node, def.name);
      }
      return 'unknown';
    }

    /**
     * `const db = getDb()` (a handle) | `const { sql: raw } = getRequestConnection()`
     * (a handle under ANY local name — the PROPERTY decides, not the alias) |
     * `const conn = getRequestConnection()` (the connection OBJECT, whose handle
     * keys are raw) | `const x = createRuntimeConnection().sql`.
     */
    function classifyDeclarator(decl, nameNode) {
      const init = decl && unwrapAwait(decl.init);
      if (!init) return 'unknown';
      const factory = rawFactoryName(init);
      if (factory === 'getDb') return 'raw';
      if (factory) {
        if (decl.id && decl.id.type === 'ObjectPattern') {
          if (bindsHandleKey(decl.id, nameNode)) return 'raw';
          // `const { ...rest } = getRequestConnection()`: the rest binding holds
          // EVERY key the factory returned, handles included, so it is the
          // connection object under another name.
          return bindsRest(decl.id, nameNode) ? 'connection' : 'unknown';
        }
        return 'connection';
      }
      if (init.type === 'MemberExpression' && isRawExpr(init)) return 'raw';
      return 'unknown';
    }

    /** Did this object pattern bind `nameNode` as its REST element? */
    function bindsRest(pattern, nameNode) {
      if (!nameNode) return false;
      return pattern.properties.some(
        (property) =>
          property.type === 'RestElement' &&
          property.argument &&
          property.argument.type === 'Identifier' &&
          property.argument.name === nameNode.name,
      );
    }

    /** Did this object pattern bind `nameNode` to a `db`/`sql`/`pg` property? */
    function bindsHandleKey(pattern, nameNode) {
      if (!nameNode) return false;
      return pattern.properties.some((property) => {
        if (property.type !== 'Property') return false;
        const key = staticKeyName(property.computed, property.key);
        if (key === null || !RAW_HANDLE_KEYS.has(key)) return false;
        const value = property.value;
        return (
          value === nameNode ||
          (value.type === 'AssignmentPattern' && value.left === nameNode)
        );
      });
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
      ...sdfCallerVisitors,
      // `` sql`select …` `` on the raw postgres.js handle — no method call to
      // catch, so the tagged template is its own visitor.
      TaggedTemplateExpression(node) {
        if (!isRawExpr(node.tag)) return;
        context.report({
          node: node.tag,
          messageId: 'bareQuery',
          data: { method: 'sql``' },
        });
      },
      CallExpression(node) {
        // The spread above cannot carry a second `CallExpression`, so the SDF
        // fence's `require('…')` branch is invoked here by hand.
        reportSdfRequire(node);
        const callee = node.callee;
        if (callee.type === 'Identifier') {
          // A plain call: the hazard is handing the raw handle to a helper that
          // trusts its caller to have scoped it.
          const helper = callee.name;
          if (RAW_SENSITIVE_HELPERS.has(helper) && isRawExpr(node.arguments[0])) {
            context.report({ node: callee, messageId: 'rawHandleArgument', data: { helper } });
          }
          return;
        }
        if (callee.type !== 'MemberExpression') return;
        // Computed too: `getDb()['select']()` and getDb()[`select`]() run the
        // same BYPASSRLS query as `getDb().select()`, and only the punctuation
        // differs. staticKeyName resolves both forms, or null for a genuinely
        // dynamic key, which this rule cannot follow and does not pretend to.
        const method = staticKeyName(callee.computed, callee.property);
        if (method === null || !QUERY_METHODS.has(method)) return;
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
