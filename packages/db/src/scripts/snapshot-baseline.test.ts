import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EMPTY_PREV_ID,
  baselineSnapshotName,
  baselineToWrite,
  compareWithBaseline,
  previousSnapshotName,
  snapshotName,
  type Snapshot,
} from './snapshot-baseline';

// The failure these pin is the one the gate was written to end, re-armed by the
// gate's own two literals. Everything below is a FIXTURE migrations folder built
// in a temp directory: no drizzle-kit, no database, no touching the real
// `migrations/`. The scenario in every case is "wave 7 landed 0052", because
// that is the day the old code broke.

const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A snapshot with exactly one table, so a "stale" one is one column apart. */
function snapshot(id: string, prevId: string, columns: string[]): Snapshot {
  return {
    id,
    prevId,
    version: '7',
    dialect: 'postgresql',
    tables: {
      'public.clients': {
        name: 'clients',
        columns: Object.fromEntries(columns.map((column) => [column, { name: column }])),
      },
    },
    enums: {},
  };
}

/**
 * A migrations folder whose journal's newest entry is 0052, with whichever
 * snapshot files the case needs.
 */
function migrationsFolderWith(snapshots: Record<string, Snapshot>): string {
  const root = mkdtempSync(join(tmpdir(), 'metra-baseline-test-'));
  fixtures.push(root);
  mkdirSync(join(root, 'meta'), { recursive: true });
  writeFileSync(
    join(root, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: [
        { idx: 16, version: '7', when: 1_700_000_000_000, tag: '0016_stage_templates', breakpoints: true },
        { idx: 51, version: '7', when: 1_789_683_557_550, tag: '0051_variation_event_actor_channel', breakpoints: true },
        { idx: 52, version: '7', when: 1_789_700_000_000, tag: '0052_narrow_set_null_fks', breakpoints: true },
      ],
    }),
  );
  for (const [name, content] of Object.entries(snapshots)) {
    writeFileSync(join(root, 'meta', name), `${JSON.stringify(content, null, 2)}\n`);
  }
  return root;
}

const GENERATED = snapshot('generated-id', 'ignored', ['id', 'org_id', 'phone']);

describe('which snapshot is the baseline', () => {
  it('names the snapshot of the NEWEST journal entry, not a literal', () => {
    const folder = migrationsFolderWith({});
    expect(baselineSnapshotName(folder)).toBe('meta/0052_snapshot.json');
    expect(snapshotName(7)).toBe('meta/0007_snapshot.json');
  });

  it('chains to the newest snapshot that EXISTS below it — meta/ is sparse', () => {
    // 0017-0050 were never written, so "previous" is 0051 when it exists and
    // 0016 when it does not. Never idx - 1.
    const withBoth = migrationsFolderWith({
      '0016_snapshot.json': snapshot('sixteen', EMPTY_PREV_ID, ['id']),
      '0051_snapshot.json': snapshot('fifty-one', 'sixteen', ['id']),
    });
    expect(previousSnapshotName(withBoth, 52)).toBe('meta/0051_snapshot.json');
    expect(previousSnapshotName(withBoth, 51)).toBe('meta/0016_snapshot.json');

    const empty = migrationsFolderWith({});
    expect(previousSnapshotName(empty, 52)).toBeNull();
  });
});

describe('compareWithBaseline', () => {
  it('(a) a 0052 entry with a CORRECT 0052 snapshot is OK', () => {
    const folder = migrationsFolderWith({
      '0051_snapshot.json': snapshot('fifty-one', 'sixteen', ['id']),
      '0052_snapshot.json': snapshot('fifty-two', 'fifty-one', ['id', 'org_id', 'phone']),
    });
    expect(compareWithBaseline(GENERATED, folder)).toEqual({
      status: 'ok',
      baselineName: 'meta/0052_snapshot.json',
    });
  });

  it('(b) a 0052 entry with a STALE 0052 snapshot is red at the first difference', () => {
    // The dangerous half of the old defect: 0051 matched the schema and the gate
    // said OK while the file `generate` actually diffs against was a migration
    // behind. Now the stale file is the one read, so it is the one that reds.
    const folder = migrationsFolderWith({
      '0051_snapshot.json': snapshot('fifty-one', 'sixteen', ['id', 'org_id', 'phone']),
      '0052_snapshot.json': snapshot('fifty-two', 'fifty-one', ['id', 'org_id']),
    });
    const result = compareWithBaseline(GENERATED, folder);
    expect(result.status).toBe('differs');
    expect(result).toMatchObject({
      baselineName: 'meta/0052_snapshot.json',
      difference: 'tables.public.clients.columns.phone',
    });
  });

  it('(c) a 0052 entry with NO 0052 snapshot names the missing file', () => {
    // The other half: a hand-authored migration nobody re-baselined. The old
    // code read 0051, found it correct, and exited 0.
    const folder = migrationsFolderWith({
      '0051_snapshot.json': snapshot('fifty-one', 'sixteen', ['id', 'org_id', 'phone']),
    });
    expect(compareWithBaseline(GENERATED, folder)).toEqual({
      status: 'missing',
      baselineName: 'meta/0052_snapshot.json',
      tag: '0052_narrow_set_null_fks',
    });
  });

  it('ignores id/prevId, which are per-generation identity and not schema', () => {
    const folder = migrationsFolderWith({
      '0052_snapshot.json': snapshot('a-completely-different-id', 'and-prev', [
        'id',
        'org_id',
        'phone',
      ]),
    });
    expect(compareWithBaseline(GENERATED, folder).status).toBe('ok');
  });
});

describe('baselineToWrite', () => {
  it('writes the NEWEST entry’s snapshot, chained to the newest one below it', () => {
    const folder = migrationsFolderWith({
      '0016_snapshot.json': snapshot('sixteen', EMPTY_PREV_ID, ['id']),
      '0051_snapshot.json': snapshot('fifty-one', 'sixteen', ['id']),
    });
    const { baselineName, previousName, baseline } = baselineToWrite(GENERATED, folder);
    // The old script rewrote 0051 here, which is what broke 0052.prevId.
    expect(baselineName).toBe('meta/0052_snapshot.json');
    expect(previousName).toBe('meta/0051_snapshot.json');
    expect(baseline.prevId).toBe('fifty-one');
  });

  it('starts the chain when no earlier snapshot exists', () => {
    const folder = migrationsFolderWith({});
    expect(baselineToWrite(GENERATED, folder).baseline.prevId).toBe(EMPTY_PREV_ID);
  });

  it('round-trips: what --write produces is what the check then calls OK', () => {
    const folder = migrationsFolderWith({
      '0051_snapshot.json': snapshot('fifty-one', 'sixteen', ['id']),
    });
    const { baselineName, baseline } = baselineToWrite(GENERATED, folder);
    writeFileSync(resolve(folder, baselineName), `${JSON.stringify(baseline, null, 2)}\n`);
    expect(compareWithBaseline(GENERATED, folder).status).toBe('ok');
  });
});
