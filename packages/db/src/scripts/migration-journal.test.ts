import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The journal is the migrator's ONLY input. `migrate()` does not read the
// migrations FOLDER — it reads `meta/_journal.json`, and for each entry applies
// the file when `Number(lastDbMigration.created_at) < entry.when`
// (drizzle-orm/pg-core/dialect.js:62). Two failure modes follow, both SILENT:
//
//   1. a .sql file with no journal entry is never applied, with no error and no
//      log line. That is D7: `0051_variation_event_actor_channel.sql` was
//      hand-authored without its entry, CI's `migrate` step reported success,
//      and the failure surfaced one step later at `apply-rls`, where
//      `app_variation_by_token` could not be created because the column it
//      selects did not exist.
//
//   2. an entry whose `when` is NOT above every earlier entry's is skipped on
//      any database that already applied the earlier one — again with no error.
//      `drizzle-kit generate` stamps `when` with `Date.now()`, so a file
//      hand-stamped into the FUTURE poisons every migration authored before
//      that instant.
//
// CI cannot reproduce either one: it migrates a FRESH Postgres, where
// `lastDbMigration` is undefined and every listed file is applied regardless of
// order. So the checks live here, in a unit test that needs no database.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/scripts
const migrationsFolder = resolve(here, '../../migrations');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journal: { entries: JournalEntry[] } = JSON.parse(
  readFileSync(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8'),
);

/**
 * Entries stamped ahead of wall-clock BEFORE the rule below existed. They cannot
 * be lowered: 0050 is already applied on production, where the migrator stored
 * its `when` as `created_at`, and that stored value is a FLOOR — a later entry
 * at or below it would be skipped there. 0051 therefore sits one millisecond
 * above 0050 rather than at its real authoring time, which is the lowest stamp
 * that still applies.
 *
 * Nothing may be added to this list. A new migration is stamped with the real
 * time it was authored, and must still exceed every entry above it.
 *
 * CONSEQUENCE, until 2026-09-17T22:19:17.550Z: no new migration can satisfy
 * both rules, because the real time is still below 0051's stamp. That window
 * closes on its own; a migration authored after it is stamped normally. One
 * authored inside it must wait for the window, not be hand-stamped ahead.
 */
const STAMPED_AHEAD_OF_WALL_CLOCK = new Set([
  '0050_transition_idempotency',
  '0051_variation_event_actor_channel',
]);

describe('migrations/meta/_journal.json', () => {
  it('finds the journal it is meant to be checking', () => {
    // A guard on the guard: an empty or reshaped journal would otherwise make
    // every assertion below pass by checking nothing.
    expect(journal.entries.length).toBeGreaterThan(50);
  });

  it('lists every .sql file in the migrations folder, and nothing that is missing', () => {
    const onDisk = readdirSync(migrationsFolder)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.slice(0, -'.sql'.length))
      .sort();
    const listed = journal.entries.map((entry) => entry.tag).sort();
    expect(listed).toEqual(onDisk);
  });

  it('numbers its entries 0..n in array order', () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    );
  });

  it('stamps `when` strictly increasing, so no entry can be silently skipped', () => {
    const outOfOrder = journal.entries
      .filter((entry, index) => index > 0 && entry.when <= journal.entries[index - 1].when)
      .map((entry) => `${entry.tag} (when=${entry.when}) is not above the entry before it`);
    expect(outOfOrder).toEqual([]);
  });

  it('stamps `when` with a real instant, never a future one', () => {
    const now = Date.now();
    const inTheFuture = journal.entries
      .filter((entry) => entry.when > now && !STAMPED_AHEAD_OF_WALL_CLOCK.has(entry.tag))
      .map(
        (entry) =>
          `${entry.tag} (when=${entry.when}, ${new Date(entry.when).toISOString()}) is stamped ` +
          'in the future: every migration authored before that instant would be skipped on a ' +
          'database that has already applied it.',
      );
    expect(inTheFuture).toEqual([]);
  });
});
