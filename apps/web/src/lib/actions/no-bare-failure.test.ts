import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A BAN on the two failures that tell a person nothing they can act on:
// `generic` ("something went wrong") and `invalid` ("that did not work"). The
// per-file ratchet that counted them reached zero in W3 (AC 22), so the scan is
// now strict: any file outside the sanctioned producers that builds either
// fails here and names the line.
//
// The way out is never a new bare code: a field error (`fieldsFailed`), the
// domain code that names the cause, `malformed` / `record_not_found`, or for a
// truly unknown failure `unexpectedFailure(label, e)`, which logs and hands the
// person a reference. Its own module, the mutation tail and the client link
// pages' `portalActFailure` are the only places allowed to build `generic`.

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
    const lines = readFileSync(path, 'utf8').split('\n');
    const hits = lines.flatMap((line, index) =>
      [...line.matchAll(BARE_FAILURE)].map(() => `${file}:${index + 1}: ${line.trim()}`),
    );
    if (hits.length > 0) found.set(file, hits);
  }
  return found;
}

describe('no bare generic / invalid failure (AC 22)', () => {
  const found = bareFailures();

  it('the scan still sees the producer it is meant to see', () => {
    // A scan that silently matched nothing would pass forever: the sanctioned
    // producer is the proof that it still matches.
    expect(found.has('lib/actions/unexpected.ts')).toBe(true);
  });

  it('nothing outside the sanctioned producers builds one', () => {
    const outside = [...found].filter(([file]) => !SANCTIONED.has(file)).flatMap(([, hits]) => hits);
    expect(outside, `Name the cause instead:\n${outside.join('\n')}`).toEqual([]);
  });
});
