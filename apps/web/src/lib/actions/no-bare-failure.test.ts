import { describe, expect, it } from 'vitest';
import { bareFailures } from '@/test/bare-failures';
import { loadSourceGraph, srcRelative } from '@/test/source-graph';

// A BAN on the two failures that tell a person nothing they can act on:
// `generic` ("something went wrong") and `invalid` ("that did not work"). The
// per-file ratchet that counted them reached zero in W3 (AC 22), so the scan is
// strict: any file outside the sanctioned modules that builds either fails
// here and names the line. What counts as building one, in every spelling, is
// test/bare-failures.ts (F12).
//
// The way out is never a new bare code: a field error (`fieldsFailed`), the
// domain code that names the cause, `malformed` / `record_not_found`, a
// failure passed on whole (`failureOf`), or for a truly unknown failure
// `unexpectedFailure(label, e)`, which logs and hands the person a reference.

/** The modules whose job is `generic`: the studio's producer, the client link
 *  pages' producer (it logs `{ act, reference, failure }`), the renderer that
 *  says it (with the reference, when there is one), the /d portal's narrowing of
 *  a code nobody sent (the server's reference rides along), and the catalogue
 *  slices that name its message. */
const SANCTIONED = new Set([
  'lib/actions/unexpected.ts',
  'lib/share/portal-act-failure.ts',
  'lib/actions/error-message.ts',
  'lib/engagements/portal-error-key.ts',
  'i18n/client-namespaces.ts',
]);

describe('no bare generic / invalid failure (AC 22)', () => {
  const found = new Map<string, string[]>();
  for (const [path, file] of loadSourceGraph().files) {
    if (srcRelative(path).startsWith('test/')) continue;
    const hits = bareFailures(file);
    if (hits.length > 0) found.set(srcRelative(path), hits);
  }

  it('the scan still sees the producer it is meant to see', () => {
    // A scan that silently matched nothing would pass forever: the sanctioned
    // producer is the proof that it still matches.
    expect(found.has('lib/actions/unexpected.ts')).toBe(true);
  });

  it('every sanctioned module still builds one (an entry that no longer does goes)', () => {
    for (const file of SANCTIONED) expect(found.has(file), file).toBe(true);
  });

  it('nothing outside the sanctioned modules builds one', () => {
    const outside = [...found]
      .filter(([file]) => !SANCTIONED.has(file))
      .flatMap(([file, hits]) => hits.map((hit) => `${file}:${hit}`));
    expect(outside, `Name the cause instead:\n${outside.join('\n')}`).toEqual([]);
  });
});
