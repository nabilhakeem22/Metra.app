// Does `migrations/meta/0051_snapshot.json` still describe `src/schema/`?
//
// WHY THIS EXISTS. `drizzle-kit generate` does not read the migrations FOLDER —
// it diffs the schema against the NEWEST SNAPSHOT. `meta/` held 17 snapshots for
// 52 migrations, so the next `generate` would have diffed against 0016 and
// re-proposed most of the schema as new. Nothing said so: the command just
// produces a wrong migration, quietly. This check is the thing that says so.
//
// TWO MODES, ONE SCRIPT, so the check and the fix can never diverge:
//
//   (default)  compare and exit 1 on a difference   — `npm run db:assert-snapshot`
//   --write    rewrite the baseline and exit 0      — `npm run db:generate-baseline`
//
// NO DATABASE, EVER. `generate` is invoked with explicit CLI flags and NO
// `--config`, so `drizzle.config.ts` is never evaluated, `MIGRATION_DATABASE_URL()`
// is never called and no socket is opened. Run it with `DATABASE_URL` unset and it
// still exits 0 — which is the proof, and which is why the CI step runs with that
// variable absent from its env.
//
// WHY THE EMPTY TEMP DIRECTORY IS LOAD-BEARING. drizzle prompts on a rename only
// when a diff contains both a drop and a create it can pair. A generate into an
// EMPTY output directory has no previous snapshot, so EVERY object is a create and
// the rename-detection branch is unreachable. That is what makes this
// headless-safe, and it is exactly why the check does not run `generate` in place:
// in place, it can open an interactive TUI that cannot answer itself and will hang
// a runner. stdin is closed as well, belt and braces.
//
// The `.sql` the generator also writes is DISCARDED with the temp directory. Only
// `meta/0051_snapshot.json` is ever written back.
import { deepStrictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts

/**
 * drizzle-kit globs the `--schema` and `--out` values, and a Windows backslash
 * is a glob ESCAPE character there: passed as `...\src\schema\index.ts` it
 * answers "No schema files found for path config". Measured. Forward slashes
 * work on both platforms.
 */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

const schemaPath = toPosix(resolve(here, '../schema/index.ts'));
const baselinePath = resolve(here, '../../migrations/meta/0051_snapshot.json');

/** The snapshot chain: 0051 continues from 0016, the newest one that exists. */
const PREV_SNAPSHOT = resolve(here, '../../migrations/meta/0016_snapshot.json');

const GENERATE_TIMEOUT_MS = 180_000;

/**
 * drizzle-kit's own entrypoint, to be run with THIS node — not through `npx`.
 *
 * `npx` is a `.cmd` shim on Windows and Node refuses to spawn one without
 * `shell: true` (EINVAL, since the CVE-2024-27980 fix — measured here, not
 * guessed). Handing paths to a shell is how argument-quoting bugs get in, and
 * every argument below is a filesystem path. Resolving the package's own bin and
 * running it under `process.execPath` needs no shell on any platform.
 *
 * The package root is found by resolving drizzle-kit's MAIN entry and walking up
 * to the directory that holds its `package.json`: the package's `exports` map
 * does not publish `./package.json`, so it cannot be required by subpath. Node
 * hoists the install to the workspace root, which is why this is resolved rather
 * than assumed.
 */
function drizzleKitBin(): string {
  const requireFromHere = createRequire(import.meta.url);
  let dir = dirname(requireFromHere.resolve('drizzle-kit'));
  for (;;) {
    const manifestPath = join(dir, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: string;
        bin?: Record<string, string> | string;
      };
      if (manifest.name === 'drizzle-kit' && manifest.bin) {
        const bin =
          typeof manifest.bin === 'string' ? manifest.bin : manifest.bin['drizzle-kit'];
        return resolve(dir, bin);
      }
    } catch {
      // Not this directory; keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('could not locate the drizzle-kit bin');
    dir = parent;
  }
}

type Snapshot = Record<string, unknown> & {
  id?: string;
  prevId?: string;
  tables?: Record<string, unknown>;
  enums?: Record<string, unknown>;
};

/** Generate into a fresh empty directory and return the snapshot it wrote. */
function generateIntoTempDir(): Snapshot {
  const out = mkdtempSync(join(tmpdir(), 'metra-snapshot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [
        drizzleKitBin(),
        'generate',
        '--dialect=postgresql',
        '--casing=snake_case',
        `--schema=${schemaPath}`,
        `--out=${toPosix(out)}`,
        '--name=snapshot_check',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: GENERATE_TIMEOUT_MS, encoding: 'utf8' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `drizzle-kit generate exited ${String(result.status)} (signal ${String(result.signal)}).\n` +
          `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      );
    }
    // A duplicated index name makes drizzle-kit WARN and write nothing while
    // still exiting 0, so the missing file is the only honest signal.
    const written = join(out, 'meta', '0000_snapshot.json');
    let raw: string;
    try {
      raw = readFileSync(written, 'utf8');
    } catch {
      throw new Error(
        'drizzle-kit generate wrote no snapshot. Its output was:\n' +
          `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      );
    }
    return JSON.parse(raw) as Snapshot;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** A copy without the two fields that are per-generation identity, not schema. */
function withoutIdentity(snapshot: Snapshot): Snapshot {
  const copy = { ...snapshot };
  delete copy.id;
  delete copy.prevId;
  return copy;
}

/** The first JSON path at which two values differ, for a useful error line. */
function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (a === b) return null;
  const bothObjects =
    typeof a === 'object' && a !== null && typeof b === 'object' && b !== null;
  if (!bothObjects) return path || '(root)';
  const keys = new Set([
    ...Object.keys(a as Record<string, unknown>),
    ...Object.keys(b as Record<string, unknown>),
  ]);
  for (const key of [...keys].sort()) {
    const next = firstDifference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
    );
    if (next) return next;
  }
  return null;
}

const FIX_INSTRUCTIONS =
  'The drizzle snapshot is behind `src/schema/`. Re-baseline it:\n' +
  '  npm run db:generate-baseline\n' +
  'which writes `migrations/meta/0051_snapshot.json` and NOTHING else — it never\n' +
  'touches a database and never asks a question. Then commit that one file.\n' +
  'DO NOT run `drizzle-kit generate` in place to fix this: it will try to author a\n' +
  'migration you did not ask for, and it can open a rename prompt that cannot\n' +
  'answer itself.';

function main() {
  const write = process.argv.includes('--write');
  const generated = generateIntoTempDir();
  const tables = Object.keys(generated.tables ?? {}).length;
  const enums = Object.keys(generated.enums ?? {}).length;

  if (write) {
    const prevId = (JSON.parse(readFileSync(PREV_SNAPSHOT, 'utf8')) as Snapshot).id;
    const baseline = { ...generated, prevId };
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(
      `db:generate-baseline: wrote migrations/meta/0051_snapshot.json — ` +
        `${tables} tables, ${enums} enums, prevId ${String(prevId)}.\n` +
        'That is the ONLY file written. The .sql drizzle-kit also emits was ' +
        'discarded with the temp directory — do not go looking for it, and do ' +
        'not commit one.',
    );
    return;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Snapshot;
  const left = withoutIdentity(baseline);
  const right = withoutIdentity(generated);
  try {
    deepStrictEqual(left, right);
  } catch {
    const where = firstDifference(left, right) ?? '(unknown)';
    console.error(
      `assert-snapshot: meta/0051_snapshot.json does NOT match the schema.\n` +
        `First difference at: ${where}\n\n${FIX_INSTRUCTIONS}`,
    );
    process.exit(1);
  }
  console.log(
    `assert-snapshot: OK — ${tables} tables, ${enums} enums; ` +
      'meta/0051_snapshot.json matches the schema.',
  );
}

try {
  main();
} catch (error) {
  console.error('assert-snapshot failed:', (error as Error).message);
  process.exit(1);
}
