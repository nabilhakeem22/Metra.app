import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AC10, OD2 strict (H6.2): the client home signs the contract only through
// the code-checked wrapper. The contract acknowledgement it wraps is CALLED
// from one place in the app, /c's own (lib/contracts/public.ts), and that
// function is used by /c's actions only, until plan H6.3 moves /c onto the
// code too and DB step C2 makes the SQL refuse a call without the code's flag
// (both checks retire with C2). Comments may name the SQL function; a call is
// its name followed by "(", with any white space between (security L2: the
// SDF runner accepts that spacing too).

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib/client-home
const SOURCE_ROOT = resolve(here, '../..'); // apps/web/src
const UNVERIFIED_SIGN_CALL = /\bapp_contract_ack_by_token\s*\(/;
const UNVERIFIED_SIGN_FUNCTION = /\backnowledgeContractByToken\b/;
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

describe('the home signs a contract only with a code (AC10)', () => {
  it('calls the unverified acknowledgement from lib/contracts/public.ts only, however the call is spaced', () => {
    expect(filesMatching(UNVERIFIED_SIGN_CALL)).toEqual(['lib/contracts/public.ts']);
    expect(UNVERIFIED_SIGN_CALL.test('select public.app_contract_ack_by_token \n (')).toBe(true);
    expect(UNVERIFIED_SIGN_CALL.test('select public.app_home_contract_ack_by_token(')).toBe(false);
  });

  it('uses the function that makes that call from /c actions only', () => {
    expect(filesMatching(UNVERIFIED_SIGN_FUNCTION)).toEqual(['app/[locale]/c/[token]/actions.ts', 'lib/contracts/public.ts']);
  });

  it('the code-checked wrapper is what the home calls', () => {
    expect(readFileSync(join(here, 'code-acts.ts'), 'utf8')).toMatch(/select public\.app_home_contract_ack_by_token\(/);
  });
});
