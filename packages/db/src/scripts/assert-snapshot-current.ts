// Does the BASELINE SNAPSHOT still describe `src/schema/`?
//
// WHICH snapshot is the baseline is derived from `migrations/meta/_journal.json`
// - the newest entry's index - and never typed here as a literal. See
// `snapshot-baseline.ts` for why that matters: two hardcoded names (0051 and its
// chain predecessor 0016) made this gate go red on a correct tree the moment a
// 0052 landed, and made its own printed remedy re-arm the silent failure.
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
// the baseline snapshot itself is ever written back.
//
// THE GENERATOR VERSION IS PART OF THE ARTEFACT, which is why `drizzle-kit` is
// pinned EXACTLY (`"0.28.1"`, not `"^0.28.1"`) in packages/db. The committed
// snapshot is that version's byte output. CI runs `npm ci` and was always
// pinned by the lockfile; a developer running `npm install` was not, and on
// 0.28.x+1 this check would go red and instruct `db:generate-baseline`, which
// would re-baseline to the NEW generator's output and commit it — reddening CI
// the other way. The fix instruction and the gate must not be able to diverge.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineToWrite, compareWithBaseline, type Snapshot } from './snapshot-baseline';

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
const migrationsFolder = resolve(here, '../../migrations');

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

function fixInstructions(baselineName: string): string {
  return (
    'The drizzle snapshot is behind `src/schema/`. Re-baseline it:\n' +
    '  npm run db:generate-baseline\n' +
    `which writes \`migrations/${baselineName}\` and NOTHING else — it never\n` +
    'touches a database and never asks a question. Then commit that one file.\n' +
    'DO NOT run `drizzle-kit generate` in place to fix this: it will try to author a\n' +
    'migration you did not ask for, and it can open a rename prompt that cannot\n' +
    'answer itself.'
  );
}

function main() {
  const write = process.argv.includes('--write');
  const generated = generateIntoTempDir();
  const tables = Object.keys(generated.tables ?? {}).length;
  const enums = Object.keys(generated.enums ?? {}).length;

  if (write) {
    const { baselineName, previousName, baseline } = baselineToWrite(
      generated,
      migrationsFolder,
    );
    writeFileSync(
      resolve(migrationsFolder, baselineName),
      `${JSON.stringify(baseline, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `db:generate-baseline: wrote migrations/${baselineName} — ` +
        `${tables} tables, ${enums} enums, prevId ${String(baseline.prevId)} ` +
        `(${previousName ?? 'no earlier snapshot — this one starts the chain'}).\n` +
        'That is the ONLY file written. The .sql drizzle-kit also emits was ' +
        'discarded with the temp directory — do not go looking for it, and do ' +
        'not commit one.',
    );
    return;
  }

  const comparison = compareWithBaseline(generated, migrationsFolder);
  if (comparison.status === 'missing') {
    console.error(
      `assert-snapshot: migrations/${comparison.baselineName} does not exist, and it is ` +
        `what \`generate\` diffs against — journal entry ${comparison.tag} is the newest.\n\n` +
        fixInstructions(comparison.baselineName),
    );
    process.exit(1);
  }
  if (comparison.status === 'differs') {
    console.error(
      `assert-snapshot: ${comparison.baselineName} does NOT match the schema.\n` +
        `First difference at: ${comparison.difference}\n\n` +
        fixInstructions(comparison.baselineName),
    );
    process.exit(1);
  }
  console.log(
    `assert-snapshot: OK — ${tables} tables, ${enums} enums; ` +
      `${comparison.baselineName} matches the schema.`,
  );
}

try {
  main();
} catch (error) {
  console.error('assert-snapshot failed:', (error as Error).message);
  process.exit(1);
}
