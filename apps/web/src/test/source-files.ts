import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// TEST-ONLY. The source the Worker (and the scripts beside it) is built from,
// read as text, for the static guards that refuse a pattern anywhere in it
// (respond-arity.test.ts, fetch-redirect-mode.test.ts). Tests and build output
// are not source, so they are skipped.

export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.open-next', '.wrangler']);
const SOURCE = /\.(tsx?|[cm]?js)$/;
const TEST = /\.(test|dbtest)\.[cm]?[jt]sx?$/;

function sourcePaths(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return SKIPPED_DIRECTORIES.has(name) ? [] : sourcePaths(path);
    return SOURCE.test(name) && !TEST.test(name) ? [path] : [];
  });
}

/**
 * Every .ts, .tsx, .js, .mjs and .cjs file under the repo-relative `roots`
 * (tests aside), with its text. `path` is repo-relative with '/'. A root that
 * does not exist is skipped.
 */
export function workerSourceFiles(roots: readonly string[]): Array<{ path: string; text: string }> {
  return roots
    .map((root) => join(REPO_ROOT, root))
    .filter((root) => existsSync(root))
    .flatMap(sourcePaths)
    .map((path) => ({ path: relative(REPO_ROOT, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));
}
