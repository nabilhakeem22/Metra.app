// What the RLS SQL DECLARES — parsed out of the files `rls/manifest.ts` names.
//
// Separate from `schema-catalogue.ts` because it answers a different question
// from a different source: that file reads drizzle TABLE OBJECTS, this one
// reads SQL TEXT. The two are compared against different catalogues and by
// different callers.
//
// RLS_APPLY_ORDER is the SAME list `apply-rls` applies, so nothing here can
// drift from what is actually run — and a `.sql` file under `rls/` that is not
// in the manifest is invisible to both, which is what
// `rls/functions-order.test.ts` exists to catch.
//
// The three parsers are pure functions of a string so they can be tested on
// fixtures rather than only on the real tree: a regex that silently stops
// matching would otherwise turn a gate into a green no-op, which is the exact
// failure class this wave is about.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RLS_APPLY_ORDER } from '../rls/manifest';

const rlsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../rls');

/** Only `create` counts. The `drop ... if exists` before each one is what makes
 * the file idempotent, not a declaration. */
const FUNCTION_PATTERN = /create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi;
const POLICY_PATTERN = /create\s+policy\s+([a-z0-9_]+)\s+on\s+public\.([a-z0-9_]+)/gi;
/** `create trigger <name>` and `on public.<table>` are on different LINES, so
 * this crosses the newline to the first `on public.` after the timing keyword. */
const TRIGGER_PATTERN =
  /create\s+trigger\s+([a-z0-9_]+)\s+(?:before|after|instead\s+of)[\s\S]*?\son\s+public\.([a-z0-9_]+)/gi;

/** The function names a chunk of RLS SQL creates. */
export function functionsIn(content: string): string[] {
  return [...content.matchAll(FUNCTION_PATTERN)].map((match) => match[1]);
}

/**
 * The policies a chunk of RLS SQL creates, as `<table>.<policy>`.
 * The TABLE is part of the key because the name alone is not unique: 45 of the
 * 46 policies in this tree are called `org_isolation`.
 */
export function policiesIn(content: string): string[] {
  return [...content.matchAll(POLICY_PATTERN)].map((match) => `${match[2]}.${match[1]}`);
}

/** The triggers a chunk of RLS SQL creates, as `<table>.<trigger>`. */
export function triggersIn(content: string): string[] {
  return [...content.matchAll(TRIGGER_PATTERN)].map((match) => `${match[2]}.${match[1]}`);
}

/** Walk the manifest, mapping every declared key to the file that declares it. */
function declaredInManifest(parse: (content: string) => string[]): Map<string, string> {
  const declared = new Map<string, string>();
  for (const file of RLS_APPLY_ORDER) {
    const content = readFileSync(resolve(rlsDir, file), 'utf8');
    for (const key of parse(content)) declared.set(key, file);
  }
  return declared;
}

/** Every function the RLS SQL creates, as function name -> its file. */
export function declaredFunctions(): Map<string, string> {
  return declaredInManifest(functionsIn);
}

/** Every policy the RLS SQL creates, as `<table>.<policy>` -> its file. */
export function declaredPolicies(): Map<string, string> {
  return declaredInManifest(policiesIn);
}

/** Every trigger the RLS SQL creates, as `<table>.<trigger>` -> its file. */
export function declaredTriggers(): Map<string, string> {
  return declaredInManifest(triggersIn);
}
