// WHICH snapshot is the baseline, and what does it chain to? Derived from the
// journal, never typed as a literal.
//
// `drizzle-kit generate` diffs `src/schema/` against the snapshot of the NEWEST
// journal entry. `assert-snapshot-current.ts` used to name that file by hand
// (`meta/0051_snapshot.json`) and its chain predecessor too
// (`meta/0016_snapshot.json`), which held only until the next migration landed.
// Measured on a simulated 0052: the gate went RED on a correct tree (it compared
// the schema against 0051 while `generate` diffs against 0052), and the fix it
// printed - `db:generate-baseline` - rewrote 0051 with a fresh `id`, breaking
// `0052.prevId` and leaving the STALE 0052 snapshot green. That is the exact
// silent failure the gate exists to end, re-armed by the gate's own remedy.
//
// So the journal is the single source of truth for all three consumers - the
// gate, the generator and `migration-journal.test.ts` - and they cannot disagree
// because they all call the functions below.
//
// Reads files, opens no socket, takes no environment variable.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export type Snapshot = Record<string, unknown> & {
  id?: string;
  prevId?: string;
  tables?: Record<string, unknown>;
  enums?: Record<string, unknown>;
};

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** drizzle's own spelling: index 52 -> `meta/0052_snapshot.json`. */
export function snapshotName(idx: number): string {
  return `meta/${String(idx).padStart(4, '0')}_snapshot.json`;
}

/** The newest journal entry — the migration `generate` diffs against. */
export function newestJournalEntry(migrationsFolder: string): JournalEntry {
  const journalPath = resolve(migrationsFolder, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries?: JournalEntry[];
  };
  const newest = journal.entries?.[journal.entries.length - 1];
  if (!newest) {
    throw new Error(`${journalPath} lists no entries — there is no baseline to check.`);
  }
  return newest;
}

/** The snapshot file the newest journal entry requires, e.g. `meta/0051_snapshot.json`. */
export function baselineSnapshotName(migrationsFolder: string): string {
  return snapshotName(newestJournalEntry(migrationsFolder).idx);
}

/**
 * The newest snapshot that exists STRICTLY BELOW `idx` — what the baseline's
 * `prevId` must point at so `drizzle-kit check` can walk the chain. `meta/` is
 * deliberately sparse (0000-0016 exist, 0017-0050 were never written), so this
 * is "the newest one that is actually there", not `idx - 1`.
 */
export function previousSnapshotName(
  migrationsFolder: string,
  idx: number,
): string | null {
  const candidates = readdirSync(resolve(migrationsFolder, 'meta'))
    .filter((name) => /^\d{4}_snapshot\.json$/.test(name))
    .map((name) => ({ name, index: Number(name.slice(0, 4)) }))
    .filter((candidate) => candidate.index < idx)
    .sort((a, b) => b.index - a.index);
  return candidates.length > 0 ? `meta/${candidates[0].name}` : null;
}

/** drizzle's sentinel for "this snapshot starts the chain". */
export const EMPTY_PREV_ID = '00000000-0000-0000-0000-000000000000';

/** A copy without the two fields that are per-generation identity, not schema. */
export function withoutIdentity(snapshot: Snapshot): Snapshot {
  const copy = { ...snapshot };
  delete copy.id;
  delete copy.prevId;
  return copy;
}

/** The first JSON path at which two values differ, for a useful error line. */
export function firstDifference(a: unknown, b: unknown, path = ''): string | null {
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

export type BaselineComparison =
  | { status: 'ok'; baselineName: string }
  | { status: 'missing'; baselineName: string; tag: string }
  | { status: 'differs'; baselineName: string; difference: string };

/**
 * Compare a freshly generated snapshot against the baseline the journal names.
 * A MISSING baseline is its own status, not an exception: it is what a
 * hand-authored migration that nobody re-baselined looks like, and the file it
 * names is the whole fix.
 */
export function compareWithBaseline(
  generated: Snapshot,
  migrationsFolder: string,
): BaselineComparison {
  const entry = newestJournalEntry(migrationsFolder);
  const baselineName = snapshotName(entry.idx);
  const baselinePath = resolve(migrationsFolder, baselineName);
  if (!existsSync(baselinePath)) {
    return { status: 'missing', baselineName, tag: entry.tag };
  }
  const baseline = withoutIdentity(JSON.parse(readFileSync(baselinePath, 'utf8')) as Snapshot);
  const difference = firstDifference(baseline, withoutIdentity(generated));
  return difference === null
    ? { status: 'ok', baselineName }
    : { status: 'differs', baselineName, difference };
}

export interface BaselineToWrite {
  baselineName: string;
  previousName: string | null;
  baseline: Snapshot;
}

/** The baseline file `--write` should produce: the generated snapshot, re-chained. */
export function baselineToWrite(
  generated: Snapshot,
  migrationsFolder: string,
): BaselineToWrite {
  const entry = newestJournalEntry(migrationsFolder);
  const previousName = previousSnapshotName(migrationsFolder, entry.idx);
  const prevId = previousName
    ? ((JSON.parse(readFileSync(resolve(migrationsFolder, previousName), 'utf8')) as Snapshot)
        .id ?? EMPTY_PREV_ID)
    : EMPTY_PREV_ID;
  return {
    baselineName: snapshotName(entry.idx),
    previousName,
    baseline: { ...generated, prevId },
  };
}
