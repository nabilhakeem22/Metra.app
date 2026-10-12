import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Round D (AC A4): app code calls ONLY the seven-argument, consent-guarded
// app_delivery_respond_by_token. The six-argument function is DROPPED by the
// Round E database step (0060), so a call to it fails with 42883; the guard
// stays so such a call never comes back (and the SQL side has its own guard,
// packages/db/src/rls/retired-functions.test.ts). Read
// from the source of the app, the packages and the scripts (.ts, .tsx, .js,
// .mjs, .cjs; tests aside), and any spelling of the call: a quoted name, or
// white space before the parenthesis (D3 F8, L3).

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..');
const ROOTS = ['apps/web/src', 'apps/web/scripts', 'packages', 'scripts'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.open-next', '.wrangler']);
const SOURCE = /\.(tsx?|[cm]?js)$/;
const TEST = /\.(test|dbtest)\.[cm]?[jt]sx?$/;

/** A call of the respond function: the name, optionally quoted, then optional white space and "(". */
const RESPOND_CALL = /["']?app_delivery_respond_by_token["']?\s*\(/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return SKIPPED_DIRECTORIES.has(name) ? [] : sourceFiles(path);
    return SOURCE.test(name) && !TEST.test(name) ? [path] : [];
  });
}

/** The argument list of every call of the respond function in `source`, split at its top-level commas. */
function callArguments(source: string): string[][] {
  return [...source.matchAll(RESPOND_CALL)].map((match) => {
    let depth = 0;
    let current = '';
    const args: string[] = [];
    for (let index = match.index + match[0].length - 1; index < source.length; index += 1) {
      const character = source[index]!;
      if (character === '(' || character === '{') depth += 1;
      if (character === ')' || character === '}') depth -= 1;
      if (depth === 0) break;
      if (character === ',' && depth === 1) {
        args.push(current.trim());
        current = '';
      } else if (!(character === '(' && depth === 1)) {
        current += character;
      }
    }
    args.push(current.trim());
    return args;
  });
}

describe('the respond function from app code', () => {
  const callers = ROOTS.map((root) => join(REPO, root))
    .filter((root) => existsSync(root))
    .flatMap(sourceFiles)
    .map((path) => ({ path: relative(REPO, path).replace(/\\/g, '/'), calls: callArguments(readFileSync(path, 'utf8')) }))
    .filter((file) => file.calls.length > 0);

  it('is called from respond.ts only, with seven arguments, the third cast ::timestamptz', () => {
    expect(callers.map((file) => file.path)).toEqual(['apps/web/src/lib/engagements/public/respond.ts']);
    const [args] = callers[0]!.calls;
    expect(callers[0]!.calls).toHaveLength(1);
    expect(args).toHaveLength(7);
    expect(args![2]).toBe('${input.expectedIssueAt}::timestamptz');
  });

  it('no caller in the app, the packages or the scripts passes six arguments', () => {
    for (const file of callers) {
      for (const args of file.calls) expect(args.length, file.path).not.toBe(6);
    }
  });

  it.each([
    ['the plain form', 'select public.app_delivery_respond_by_token(${hash}, ${action}, ${note}, ${name}, ${ip}, ${ua})'],
    ['a space before the parenthesis', 'select public.app_delivery_respond_by_token (${hash}, ${action}, ${note}, ${name}, ${ip}, ${ua})'],
    ['a line break before it', 'select public.app_delivery_respond_by_token\n  (${hash}, ${action}, ${note}, ${name}, ${ip}, ${ua})'],
    ['a quoted name', 'select public."app_delivery_respond_by_token"(${hash}, ${action}, ${note}, ${name}, ${ip}, ${ua})'],
  ])('the counter is sound: it reads %s of the retired call as six', (_label, retired) => {
    expect(callArguments(retired).map((args) => args.length)).toEqual([6]);
  });
});
