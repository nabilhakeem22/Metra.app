import { readFileSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The gate that keeps the ONE shape true.
 *
 * Three folder shapes existed for one concept because `lib/proposals/core.ts` had
 * become a kernel: it re-exported the line caps, the chunked insert, the trim, the
 * percentage predicate and the date check, so `contracts`, `variations`, `boqs`
 * and both PDF routes imported the PROPOSALS module to reach them. Deleting that
 * re-export fixed today. This file is what stops it coming back, because the next
 * person to need a shared helper will reach for the nearest module that has one.
 *
 * It reads the source rather than the import graph on purpose: a lint rule would
 * be skippable with a disable comment, and a type-level trick would not survive a
 * `export *`. The substring is the contract.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url)); // apps/web/src

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Repo-relative, forward-slashed, so a failure message is greppable as written. */
function toPosix(path: string): string {
  return path.split(sep).join('/'); // `sep` is '/' off Windows, so this is a no-op there
}

function relative(file: string): string {
  return toPosix(file).slice(toPosix(SRC).length);
}

const files = sourceFiles(SRC).map((file) => ({
  path: relative(file),
  text: readFileSync(file, 'utf8'),
}));

/**
 * `automation/expire-proposals.ts` is the ONE sanctioned importer of a proposal
 * internal from outside the module: it is a proposal transition, driven by the
 * cron runner instead of by a session, and `lib/automation` is where the runner
 * lives. Anything else added here needs a reason in this comment.
 */
const SANCTIONED_INTERNAL_IMPORTERS = [
  '/lib/automation/expire-proposals.ts',
  // This file. It names the forbidden module paths as DATA, not as imports, and
  // a gate that reports itself reports nothing useful.
  '/lib/module-shape.test.ts',
];

/** The proposal internals. `queries`, `public` and `actions` are the public API. */
const PROPOSAL_INTERNALS = [
  '@/lib/proposals/core',
  '@/lib/proposals/validation',
  '@/lib/proposals/lifecycle',
];

describe('module shape', () => {
  it('finds source to read at all', () => {
    // Guards the gate itself: a broken walk would make every rule below vacuous.
    expect(files.length).toBeGreaterThan(200);
  });

  it('rule 1: nothing outside lib/proposals imports a proposal INTERNAL', () => {
    const offenders = files
      .filter((file) => !file.path.startsWith('/lib/proposals/'))
      .filter((file) => !SANCTIONED_INTERNAL_IMPORTERS.includes(file.path))
      .filter((file) => PROPOSAL_INTERNALS.some((mod) => file.text.includes(mod)))
      .map(
        (file) =>
          `${file.path} — rule 1: imports a proposals internal. ` +
          'Use @/lib/proposals/{queries,public,actions}, or move the shared piece ' +
          'to lib/{lines,money,validation,share}.',
      );
    expect(offenders).toEqual([]);
  });

  it('rule 2: lib/contracts and lib/variations do not import lib/proposals AT ALL', () => {
    const offenders = files
      .filter(
        (file) =>
          file.path.startsWith('/lib/contracts/') ||
          file.path.startsWith('/lib/variations/'),
      )
      .filter((file) => file.text.includes("from '@/lib/proposals/"))
      .map(
        (file) =>
          `${file.path} — rule 2: a document module imports another document ` +
          'module. Cross-module reuse goes through lib/<kernel>.',
      );
    expect(offenders).toEqual([]);
  });

  it('rule 3: no barrel in the three modules re-exports across module lines', () => {
    const offenders = files
      .filter((file) => /^\/lib\/(proposals|contracts|variations)\/.*\/index\.ts$/.test(file.path))
      .filter((file) => file.text.includes("from '@/lib/"))
      .map(
        (file) =>
          `${file.path} — rule 3 (barrel law): a barrel re-exports only symbols ` +
          "defined under its own module's core/, lifecycle/ or queries/.",
      );
    expect(offenders).toEqual([]);
  });

  it('rule 3 covers every barrel the three modules actually have', () => {
    // If a module loses its index.ts the rule above passes vacuously, so the
    // count is pinned: 3 modules x {core, lifecycle, queries}.
    const barrels = files.filter((file) =>
      /^\/lib\/(proposals|contracts|variations)\/.*\/index\.ts$/.test(file.path),
    );
    expect(barrels).toHaveLength(9);
    for (const barrel of barrels) expect(barrel.text).toContain('BARREL LAW');
  });
});
