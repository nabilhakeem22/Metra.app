import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import BASELINE from './no-bare-failure.baseline.json';

// A RATCHET on the two failures that tell a person nothing they can act on:
// `generic` ("something went wrong") and `invalid` ("that did not work"). Every
// producer that existed when this round began is counted per file in the
// baseline; a file may only go DOWN. A new file that produces either, or one
// more site in a counted file, fails here and names the line.
//
// The way out is never a new bare code: a field error (`fieldsFailed`), the
// domain code that names the cause, `malformed` / `record_not_found`, or for a
// truly unknown failure `unexpectedFailure(label, e)`, which logs and hands the
// person a reference. Its own module and the mutation tail are the only two
// places allowed to build `generic`.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../..');

const BARE_FAILURE = /(err|fail)\('(generic|invalid)'\)|error:\s*'(generic|invalid)'/g;

/** The modules whose job is to build `generic` (with a reference): the studio's
 *  two, and the client link pages' one (it logs `{ act, reference, failure }`). */
const SANCTIONED = new Set([
  'lib/actions/unexpected.ts',
  'lib/actions/mutation-failure.ts',
  'lib/share/portal-act-failure.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.(test|dbtest)\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Path (from src, forward slashes) to the lines that produce a bare failure. */
function bareFailures(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const path of sourceFiles(SRC)) {
    const file = relative(SRC, path).split('\\').join('/');
    if (SANCTIONED.has(file)) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    const hits = lines.flatMap((line, index) =>
      [...line.matchAll(BARE_FAILURE)].map(() => `${file}:${index + 1}: ${line.trim()}`),
    );
    if (hits.length > 0) found.set(file, hits);
  }
  return found;
}

describe('no new bare generic / invalid failure', () => {
  const baseline = BASELINE as Record<string, number>;
  const found = bareFailures();

  it('the scan sees the producers it is meant to count', () => {
    // A scan that silently matched nothing would pass forever.
    expect(found.size).toBeGreaterThan(0);
  });

  it.each([...found.entries()])('%s does not add one', (file, hits) => {
    const allowed = baseline[file] ?? 0;
    expect(
      hits.length,
      `${file} produces ${hits.length} bare failure(s), its baseline is ${allowed}. Name the cause instead:\n${hits.join('\n')}`,
    ).toBeLessThanOrEqual(allowed);
  });
});
