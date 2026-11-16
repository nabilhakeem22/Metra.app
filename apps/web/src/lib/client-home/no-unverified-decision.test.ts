import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AC12, OD2 strict (H7.1): the client home decides a change order only through
// the code-checked wrapper. The decision it wraps is CALLED from one place in the
// app, /v's own (lib/variations/public.ts), and that function is used by /v's
// action only, which sends a proposal contract's order alone: a BOQ contract's
// answers `moved` there (H7.2). DB step C2 makes the SQL refuse a call without
// the code. Comments may name the SQL function; a call is its name followed by
// "(", with any white space between.

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib/client-home
const SOURCE_ROOT = resolve(here, '../..'); // apps/web/src
const UNVERIFIED_DECISION_CALL = /\bapp_variation_respond_by_token\s*\(/;
const UNVERIFIED_DECISION_FUNCTION = /\brespondToVariationByToken\b/;
const TEST_FILE = /\.test\.tsx?$/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|json)$/.test(name) ? [path] : [];
  });
}

/** The app's files (tests left out: they mock the function by name) whose text matches `pattern`, relative to apps/web/src. */
function filesMatching(pattern: RegExp): string[] {
  const files = sourceFiles(SOURCE_ROOT).filter((path) => !TEST_FILE.test(path));
  expect(files.length).toBeGreaterThan(400);
  return files
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(SOURCE_ROOT, path).replaceAll('\\', '/'))
    .sort();
}

describe('the home decides a change order only with a code (AC12)', () => {
  it('calls the unverified decision from lib/variations/public.ts only, however the call is spaced', () => {
    expect(filesMatching(UNVERIFIED_DECISION_CALL)).toEqual(['lib/variations/public.ts']);
    expect(UNVERIFIED_DECISION_CALL.test('select public.app_variation_respond_by_token \n (')).toBe(true);
    expect(UNVERIFIED_DECISION_CALL.test('select public.app_home_variation_respond_by_token(')).toBe(false);
  });

  it('uses the function that makes that call from the /v action only', () => {
    expect(filesMatching(UNVERIFIED_DECISION_FUNCTION)).toEqual(['app/[locale]/v/[token]/actions.ts', 'lib/variations/public.ts']);
  });

  it('the code-checked wrapper is what the home calls', () => {
    expect(readFileSync(join(here, 'code-acts.ts'), 'utf8')).toMatch(/select public\.app_home_variation_respond_by_token\(/);
  });
});
