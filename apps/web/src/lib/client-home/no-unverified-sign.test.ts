import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AC10, OD2 strict (H6.2): the client home signs the contract only through
// the code-checked wrapper. The contract acknowledgement it wraps is CALLED
// from one place in the app, /c's own (lib/contracts/public.ts), until plan
// H6.3 moves /c onto the code too and DB step C2 makes the function refuse a
// call without the code's flag. Comments may name it; a call is
// `public.app_contract_ack_by_token(`.

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib/client-home
const SOURCE_ROOT = resolve(here, '../..'); // apps/web/src
const UNVERIFIED_SIGN_CALL = 'public.app_contract_ack_by_token(';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|json)$/.test(name) ? [path] : [];
  });
}

describe('the home signs a contract only with a code (AC10)', () => {
  it('calls the unverified acknowledgement from /c only, nowhere else under apps/web/src', () => {
    const files = sourceFiles(SOURCE_ROOT).filter((path) => path !== fileURLToPath(import.meta.url));
    expect(files.length).toBeGreaterThan(500);
    const callers = files
      .filter((path) => readFileSync(path, 'utf8').includes(UNVERIFIED_SIGN_CALL))
      .map((path) => relative(SOURCE_ROOT, path).replaceAll('\\', '/'));
    expect(callers).toEqual(['lib/contracts/public.ts']);
  });

  it('the code-checked wrapper is what the home calls', () => {
    expect(readFileSync(join(here, 'code-acts.ts'), 'utf8')).toContain('select public.app_home_contract_ack_by_token(');
  });
});
