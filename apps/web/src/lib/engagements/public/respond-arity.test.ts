import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Round D (AC A4): app code calls ONLY the seven-argument, consent-guarded
// app_delivery_respond_by_token. The six-argument function stays in the
// database until the next DB step (an older Worker version still calls it
// during the rollback window), and it records consent to whatever is on file
// NOW, so a TypeScript call to it would silently bring the stale-tab consent
// back. Read from the source, so a new caller anywhere under src fails here.

const SRC = join(__dirname, '..', '..', '..');
const RESPOND_SDF = 'app_delivery_respond_by_token';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The argument list of every call of the respond function in `source`, split at its top-level commas. */
function callArguments(source: string): string[][] {
  const calls: string[][] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${RESPOND_SDF}(`, from);
    if (at < 0) return calls;
    let depth = 0;
    let current = '';
    const args: string[] = [];
    for (let index = at + RESPOND_SDF.length; index < source.length; index += 1) {
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
    calls.push(args);
    from = at + 1;
  }
}

describe('the respond function from app code', () => {
  const callers = sourceFiles(SRC)
    .map((path) => ({ path: relative(SRC, path).replace(/\\/g, '/'), calls: callArguments(readFileSync(path, 'utf8')) }))
    .filter((file) => file.calls.length > 0);

  it('is called from respond.ts only, with seven arguments, the third cast ::timestamptz', () => {
    expect(callers.map((file) => file.path)).toEqual(['lib/engagements/public/respond.ts']);
    const [args] = callers[0]!.calls;
    expect(callers[0]!.calls).toHaveLength(1);
    expect(args).toHaveLength(7);
    expect(args![2]).toBe('${input.expectedIssueAt}::timestamptz');
  });

  it('no caller anywhere under src passes six arguments', () => {
    for (const file of callers) {
      for (const args of file.calls) expect(args.length, file.path).not.toBe(6);
    }
  });

  it('the counter is sound: it reads the retired form as six', () => {
    const retired = "sql`select public.app_delivery_respond_by_token(${hash}, ${action}, ${note}, ${name}, ${ip}, ${ua}) as code`";
    expect(callArguments(retired)[0]).toHaveLength(6);
  });
});
