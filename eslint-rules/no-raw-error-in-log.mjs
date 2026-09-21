// ESLint rule: forbid handing a RAW caught value to `console.error`/`console.warn`.
//
// WHY: two of this app's dependencies put tenant data on a thrown object, in a
// place the default console formatter prints.
//
//   • postgres.js `Object.assign`s every field of the server's ErrorResponse
//     onto its PostgresError, ENUMERABLE — and for a 23505 `detail` IS the
//     colliding row: `Key (org_id, email)=(…, someone@example.com) already
//     exists.`
//   • drizzle-orm, from 0.44, re-throws every query error as a
//     `DrizzleQueryError` whose OWN enumerable properties are `query`, `params`
//     and `cause`, and whose message is `Failed query: <sql>\nparams: <values>`.
//     `console.error` calls `util.inspect`, which prints the message, the query,
//     the params and the nested cause. `JSON.stringify` prints them too — on
//     drizzle 0.36 the same call printed `{}`, so the upgrade widened every one
//     of these sinks at once and nothing said so.
//
// The fix is always the same one line: wrap the value in `loggableFailure(…)`
// (`apps/web/src/lib/actions/loggable-failure.ts`), which copies a five-field
// whitelist off the DRIVER error and never the wrapper's message.
//
// WHAT IS BANNED: an argument to `console.error` / `console.warn` that is a bare
// identifier named like a caught value — including one nested one level inside
// an object literal, which is how `console.error('x', { hasSnapshot, error })`
// smuggled one past review.
//
// WHY BY NAME AND NOT BY SCOPE: a scope walk ("is this identifier bound by a
// CatchClause?") is more precise and catches LESS. `pdf/responses.ts` takes its
// thrown value as a FUNCTION PARAMETER (`renderFailure(cause, logLabel)`) and
// `i18n/request.ts` takes it as a CALLBACK PARAMETER (`onError(error)`), and
// both of those print exactly the same object. The name is what the house calls
// a thrown value, the false-positive cost is one wrap that is harmless anyway,
// and the rule stays readable.
//
// WHAT IS NOT BANNED, deliberately:
//   • `console.error('…', loggableFailure(e))` — the prescribed fix.
//   • a member expression (`e.message`, `err.code`) — the author has chosen a
//     field, which is the decision this rule wants people to make.
//   • `console.log` / `console.info` — the app does not use them on the server,
//     and widening this to every console method would make the rule about
//     logging style rather than about data leaving the tenant.
//   • test files — exempted in eslint.config.mjs, where the whole point is to
//     assert on the raw object.

/**
 * The names this codebase gives a thrown value. Adding one here is cheap;
 * the rule reports a NAME, so a new spelling of "the error" is invisible until
 * it is listed.
 */
export const CAUGHT_VALUE_NAMES = new Set([
  'e',
  'err',
  'error',
  'cause',
  'ex',
  'reason',
  'thrown',
  'failure',
]);

/** `console.error(…)` / `console.warn(…)`, and nothing else. */
function isLogCall(node) {
  const callee = node.callee;
  return (
    callee?.type === 'MemberExpression' &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'console' &&
    !callee.computed &&
    callee.property?.type === 'Identifier' &&
    (callee.property.name === 'error' || callee.property.name === 'warn')
  );
}

/** The raw identifiers this argument would print, argument or object property. */
function rawIdentifiersIn(argument) {
  if (argument.type === 'Identifier') {
    return CAUGHT_VALUE_NAMES.has(argument.name) ? [argument] : [];
  }
  if (argument.type !== 'ObjectExpression') return [];
  const found = [];
  for (const property of argument.properties) {
    // `{ error }` shorthand and `{ error: err }` both print the same object.
    if (property.type !== 'Property') continue;
    const value = property.value;
    if (value?.type === 'Identifier' && CAUGHT_VALUE_NAMES.has(value.name)) {
      found.push(value);
    }
  }
  return found;
}

export const noRawErrorInLog = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'forbid passing a raw caught value to console.error/console.warn',
    },
    schema: [],
    messages: {
      raw:
        "console.{{ method }} is being handed the raw value `{{ name }}`. A thrown " +
        'DrizzleQueryError carries the SQL and its BOUND PARAMETERS on its own ' +
        'enumerable properties, and a PostgresError carries the colliding row in ' +
        '`detail` — console prints all of it. Wrap it: ' +
        '`loggableFailure({{ name }})` from `@/lib/actions/loggable-failure`.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isLogCall(node)) return;
        const method = node.callee.property.name;
        for (const argument of node.arguments) {
          for (const identifier of rawIdentifiersIn(argument)) {
            context.report({
              node: identifier,
              messageId: 'raw',
              data: { method, name: identifier.name },
            });
          }
        }
      },
    };
  },
};
