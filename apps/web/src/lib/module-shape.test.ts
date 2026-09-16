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
 * be skippable with a disable comment, and a type-level trick would not survive an
 * `export *`. But the substring is NOT the contract — the RESOLVED MODULE is.
 * The first version of this file matched `file.text.includes("from '@/lib/…")`,
 * and a tester walked through it three ways in one afternoon: a relative path
 * (`../../proposals/core`), a double-quoted specifier, and a barrel re-exporting
 * two kernels relatively. TypeScript resolves all three to the same modules the
 * rules forbid. So every specifier is now PARSED and RESOLVED before it is judged.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url)); // apps/web/src

interface SourceFile {
  /** Repo-relative, forward-slashed, so a failure message is greppable as written. */
  path: string;
  text: string;
}

/**
 * Every `from '…'` specifier in a file: `import … from`, `export … from`,
 * `export * from`, single OR double quoted, one line or many. The character class
 * excludes quotes and semicolons so a match cannot run past the end of its own
 * statement, and it admits newlines so a multi-line `import { … }` is read whole.
 */
const SPECIFIER = /(?:^|\n)[ \t]*(?:import|export)\b[^;'"]*?from[ \t\n]*['"]([^'"]+)['"]/g;

/**
 * A specifier as the module it actually resolves to, written `@/…`.
 *
 * A relative specifier is resolved against the importing file's directory, which
 * is the whole point: `../../proposals/core` from `/lib/contracts/core/x.ts` and
 * `@/lib/proposals/core` are the same module to TypeScript, so they must be the
 * same module to this gate. `null` for a package import — not ours to police.
 */
export function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier;
  if (!specifier.startsWith('.')) return null;
  const segments = `${fromFile.slice(0, fromFile.lastIndexOf('/'))}/${specifier}`.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }
  return `@/${resolved.join('/')}`;
}

/** The modules a file depends on, each as a resolved `@/…` path. */
export function importedModules(file: SourceFile): string[] {
  const modules: string[] = [];
  for (const [, specifier] of file.text.matchAll(SPECIFIER)) {
    const resolved = resolveSpecifier(file.path, specifier);
    if (resolved) modules.push(resolved);
  }
  return modules;
}

/** Is `module` that path, or something underneath it? */
function isUnder(module: string, root: string): boolean {
  return module === root || module.startsWith(`${root}/`);
}

/**
 * `automation/expire-proposals.ts` is the ONE sanctioned importer of a proposal
 * internal from outside the module: it is a proposal transition, driven by the
 * cron runner instead of by a session, and `lib/automation` is where the runner
 * lives. Anything else added here needs a reason in this comment.
 */
const SANCTIONED_INTERNAL_IMPORTERS = [
  '/lib/automation/expire-proposals.ts',
  // This file. It carries the evasions below as source text inside fixtures, and
  // a gate that reports its own fixtures reports nothing useful.
  '/lib/module-shape.test.ts',
];

/** The proposal internals. `queries`, `public` and `actions` are the public API. */
const PROPOSAL_INTERNALS = [
  '@/lib/proposals/core',
  '@/lib/proposals/validation',
  '@/lib/proposals/lifecycle',
];

const BARREL = /^\/lib\/(proposals|contracts|variations)\/.*\/index\.ts$/;

export function ruleOneOffenders(files: SourceFile[]): string[] {
  return files
    .filter((file) => !file.path.startsWith('/lib/proposals/'))
    .filter((file) => !SANCTIONED_INTERNAL_IMPORTERS.includes(file.path))
    .filter((file) =>
      importedModules(file).some((module) =>
        PROPOSAL_INTERNALS.some((internal) => isUnder(module, internal)),
      ),
    )
    .map(
      (file) =>
        `${file.path} — rule 1: imports a proposals internal. ` +
        'Use @/lib/proposals/{queries,public,actions}, or move the shared piece ' +
        'to lib/{lines,money,validation,share}.',
    );
}

export function ruleTwoOffenders(files: SourceFile[]): string[] {
  return files
    .filter(
      (file) =>
        file.path.startsWith('/lib/contracts/') || file.path.startsWith('/lib/variations/'),
    )
    .filter((file) =>
      importedModules(file).some((module) => isUnder(module, '@/lib/proposals')),
    )
    .map(
      (file) =>
        `${file.path} — rule 2: a document module imports another document ` +
        'module. Cross-module reuse goes through lib/<kernel>.',
    );
}

export function ruleThreeOffenders(files: SourceFile[]): string[] {
  return files
    .filter((file) => BARREL.test(file.path))
    .filter((file) => {
      const ownModule = `@/lib/${file.path.split('/')[2]}`;
      return importedModules(file).some((module) => !isUnder(module, ownModule));
    })
    .map(
      (file) =>
        `${file.path} — rule 3 (barrel law): a barrel re-exports only symbols ` +
        "defined under its own module's core/, lifecycle/ or queries/.",
    );
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

function toPosix(path: string): string {
  return path.split(sep).join('/'); // `sep` is '/' off Windows, so this is a no-op there
}

const files: SourceFile[] = sourceFiles(SRC).map((file) => ({
  path: toPosix(file).slice(toPosix(SRC).length),
  text: readFileSync(file, 'utf8'),
}));

describe('module shape', () => {
  it('finds source to read at all', () => {
    // Guards the gate itself: a broken walk would make every rule below vacuous.
    expect(files.length).toBeGreaterThan(200);
  });

  it('rule 1: nothing outside lib/proposals imports a proposal INTERNAL', () => {
    expect(ruleOneOffenders(files)).toEqual([]);
  });

  it('rule 2: lib/contracts and lib/variations do not import lib/proposals AT ALL', () => {
    expect(ruleTwoOffenders(files)).toEqual([]);
  });

  it('rule 3: no barrel in the three modules re-exports across module lines', () => {
    expect(ruleThreeOffenders(files)).toEqual([]);
  });

  it('rule 3 covers every barrel the three modules actually have', () => {
    // If a module loses its index.ts the rule above passes vacuously, so the
    // count is pinned: 3 modules x {core, lifecycle, queries}.
    const barrels = files.filter((file) => BARREL.test(file.path));
    expect(barrels).toHaveLength(9);
    for (const barrel of barrels) expect(barrel.text).toContain('BARREL LAW');
  });
});

/**
 * The gate's own tests. Each fixture below is an evasion a tester EXECUTED against
 * the first version of this file and got "5 passed" for. They are fixtures rather
 * than real files so the proof survives without anybody re-adding a probe module.
 */
describe('the gate catches what was walked through it', () => {
  const file = (path: string, text: string): SourceFile[] => [{ path, text }];

  it('resolves a relative specifier the way TypeScript does', () => {
    const from = '/lib/contracts/core/create.ts';
    expect(resolveSpecifier(from, '../../proposals/core')).toBe('@/lib/proposals/core');
    expect(resolveSpecifier(from, './create-copy')).toBe('@/lib/contracts/core/create-copy');
    expect(resolveSpecifier(from, '@/lib/lines/limits')).toBe('@/lib/lines/limits');
    expect(resolveSpecifier(from, 'drizzle-orm')).toBeNull();
  });

  it('evasion A: a RELATIVE import of a proposals internal fails rules 1 and 2', () => {
    const offender = file(
      '/lib/contracts/gate-evasion.ts',
      "import { createProposalCore } from '../proposals/core';\n" +
        "import { MAX_SECTIONS } from '../proposals/core/index';\n",
    );
    expect(ruleOneOffenders(offender)).toHaveLength(1);
    expect(ruleOneOffenders(offender)[0]).toContain('rule 1');
    expect(ruleTwoOffenders(offender)).toHaveLength(1);
  });

  it('evasion B: a DOUBLE-QUOTED specifier fails rule 2', () => {
    const offender = file(
      '/lib/variations/gate-evasion.ts',
      'import { listProposals } from "@/lib/proposals/queries";\n',
    );
    expect(ruleTwoOffenders(offender)).toHaveLength(1);
  });

  it('evasion C: a barrel re-exporting kernels RELATIVELY fails rule 3', () => {
    const offender = file(
      '/lib/variations/core/index.ts',
      "// BARREL LAW\nexport { clean } from '../../validation/text';\n" +
        "export { MAX_SECTIONS } from '../../lines/limits';\n",
    );
    expect(ruleThreeOffenders(offender)).toHaveLength(1);
    expect(ruleThreeOffenders(offender)[0]).toContain('rule 3');
  });

  it('a multi-line import is read whole, and so is an export-from', () => {
    const offender = file(
      '/lib/variations/multi.ts',
      'import {\n  createProposalCore,\n  type CreateProposalInput,\n} from ' +
        "'@/lib/proposals/core';\n",
    );
    expect(ruleOneOffenders(offender)).toHaveLength(1);
    const reexport = file(
      '/lib/contracts/queries/index.ts',
      "// BARREL LAW\nexport * from '@/lib/proposals/queries';\n",
    );
    expect(ruleThreeOffenders(reexport)).toHaveLength(1);
    expect(ruleTwoOffenders(reexport)).toHaveLength(1);
  });

  it('the legal shapes stay legal', () => {
    const barrel = file(
      '/lib/proposals/core/index.ts',
      "// BARREL LAW\nexport * from './create';\nexport { sendProposalCore } from '../lifecycle';\n",
    );
    expect(ruleThreeOffenders(barrel)).toEqual([]);
    const publicApi = file(
      '/lib/contracts/core/create.ts',
      "import { listProposalsForContract } from '@/lib/proposals/queries';\n",
    );
    expect(ruleOneOffenders(publicApi)).toEqual([]); // queries is the public API…
    expect(ruleTwoOffenders(publicApi)).toHaveLength(1); // …but rule 2 is absolute
    const kernel = file(
      '/lib/variations/core/update.ts',
      "import { MAX_TOTAL_LINES } from '../../lines/limits';\n",
    );
    expect(ruleOneOffenders(kernel)).toEqual([]);
    expect(ruleTwoOffenders(kernel)).toEqual([]);
  });
});
