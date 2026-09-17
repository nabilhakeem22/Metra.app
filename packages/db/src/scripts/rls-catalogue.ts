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
//
// WHAT THEY MUST GET RIGHT, because `apply-rls` REFUSES a deploy when a declared
// object is missing from the database: a mis-parse is a false red on a correct
// database. So the text is normalised the way Postgres reads it before any
// pattern runs — comments removed (a commented-out `create policy` declares
// nothing; a comment between `before update` and `on public.x` must not move
// the table), the schema qualifier optional (`on boqs` and `on public.boqs`
// are the same table), and identifiers folded to lower case unless quoted,
// which is exactly how the catalogues will spell them back.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RLS_APPLY_ORDER } from '../rls/manifest';

const rlsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../rls');

/** An identifier as the catalogues store it: `"Quoted"` keeps its spelling
 *  (quotes dropped); anything else folds to lower case. */
const IDENT = String.raw`(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))`;
/** `public.` or nothing — both name the same table in this schema. */
const TABLE = String.raw`(?:(?:"public"|public)\.)?` + IDENT;

/** Only `create` counts. The `drop ... if exists` before each one is what makes
 * the file idempotent, not a declaration. */
const FUNCTION_PATTERN = new RegExp(
  String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+` + TABLE,
  'gi',
);
const POLICY_PATTERN = new RegExp(
  String.raw`\bcreate\s+policy\s+` + IDENT + String.raw`\s+on\s+` + TABLE,
  'gi',
);
/** `create trigger <name>` and `on <table>` are on different LINES. In the
 * CREATE TRIGGER grammar the table's `on` is the FIRST `on` after the timing
 * keyword — a `when (...)` clause can only come after it — so the lazy span
 * stops at the right place once comments are gone. */
const TRIGGER_PATTERN = new RegExp(
  String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+` +
    IDENT +
    String.raw`\s+(?:before|after|instead\s+of)\b[\s\S]*?\son\s+` +
    TABLE,
  'gi',
);

// SQL with every double-dash line comment and every slash-star block comment
// removed. Dollar-quoted bodies are left alone: nothing this file declares is
// spelled inside one.
export function withoutSqlComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
}

/** The catalogue spelling of a matched identifier pair (quoted, unquoted). */
function spelled(quoted: string | undefined, bare: string | undefined): string {
  return quoted ?? (bare ?? '').toLowerCase();
}

/** The function names a chunk of RLS SQL creates. */
export function functionsIn(content: string): string[] {
  return [...withoutSqlComments(content).matchAll(FUNCTION_PATTERN)].map((m) =>
    spelled(m[1], m[2]),
  );
}

/**
 * The policies a chunk of RLS SQL creates, as `<table>.<policy>`.
 * The TABLE is part of the key because the name alone is not unique: 45 of the
 * 46 policies in this tree are called `org_isolation`.
 */
export function policiesIn(content: string): string[] {
  return [...withoutSqlComments(content).matchAll(POLICY_PATTERN)].map(
    (m) => `${spelled(m[3], m[4])}.${spelled(m[1], m[2])}`,
  );
}

/** The triggers a chunk of RLS SQL creates, as `<table>.<trigger>`. */
export function triggersIn(content: string): string[] {
  return [...withoutSqlComments(content).matchAll(TRIGGER_PATTERN)].map(
    (m) => `${spelled(m[3], m[4])}.${spelled(m[1], m[2])}`,
  );
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
