// `market:seed-price-books`: fill every studio's price book (or the --org ones)
// from the published market book. ONE TRANSACTION PER STUDIO: a studio is
// seeded completely or not at all, one studio's failure (a code a studio typed
// in the same second, say) cannot undo another's, each transaction holds its
// locks for one studio only, and a re-run (idempotent) retries just the
// studios that failed. Returns one result per studio, in organization order.
//
// The seed book is built once for the whole run. A real run also STORES it
// (market_seed_book, rebuilt behind the market write lock): its items are
// written by reference to that stored book, and the app seeds new studios from
// it. NOTHING IS HELD BETWEEN STUDIOS: each studio's transaction holds the book
// (holdForSeed) and checks it is still the one the run planned from. When a
// publish or withdrawal changed it, that studio is not written and the run
// STOPS there (the studios after it are not reached); a re-run plans from the
// new book. A dropped connection therefore never leaves a market lock behind
// once its studio's transaction ends. A connection LOST mid-run stops the run
// the same way, at the studio it was on (`connection_lost`), so the report
// still says which studios were seeded. A dry run writes nothing.
import type { MetraDb } from '@metra/db';
import { buildSeedBook, type SeedPlan } from '@metra/db/market-seed';
import type { PostgresJs } from '../db/connection';
import { rebuildSeedBook } from './book-store';
import { isConnectionLost } from './connection-lost';
import { failureReason } from './failure';
import { readActor, readMarketSeedItems, readStudios, type Studio } from './read';
import { SeedBookChangedError, seedStudio, type RunBook } from './write';

export type StudioOutcome =
  | { studio: Studio; status: 'planned' | 'seeded'; actor: { userId: string; role: 'owner' | 'admin' }; plan: SeedPlan }
  | { studio: Studio; status: 'no_actor' }
  | { studio: Studio; status: 'failed'; error: string }
  /** The stored book changed under the run: nothing written for this studio, and the run stopped. */
  | { studio: Studio; status: 'book_changed' }
  /** The connection to the database was lost on this studio (it may have committed if its commit was in flight), and the run stopped. */
  | { studio: Studio; status: 'connection_lost'; error: string }
  /** After a stop: the run never reached this studio. */
  | { studio: Studio; status: 'not_reached' };

/** An outcome after which the run seeds no further studio. */
export type StoppingOutcome = Extract<StudioOutcome, { status: 'book_changed' | 'connection_lost' }>;

export function stoppedBy(outcome: StudioOutcome): outcome is StoppingOutcome {
  return outcome.status === 'book_changed' || outcome.status === 'connection_lost';
}

export interface SeedRun {
  marketItems: number;
  outcomes: StudioOutcome[];
}

/**
 * One studio's outcome: no actor, its plan (written unless a dry run), the
 * book changed, the connection lost, or the reason it failed. Its actor read
 * is inside the catch too: on the run's one connection, a backend terminated
 * under the previous studio surfaces on THIS read.
 */
async function seedOne(db: MetraDb, sql: PostgresJs, studio: Studio, book: RunBook, dryRun: boolean): Promise<StudioOutcome> {
  try {
    const actor = await readActor(sql, studio.id);
    if (actor === null) return { studio, status: 'no_actor' };
    const plan = await seedStudio(db, { orgId: studio.id, ...actor }, book, dryRun);
    return { studio, status: dryRun ? 'planned' : 'seeded', actor, plan };
  } catch (error) {
    if (error instanceof SeedBookChangedError) return { studio, status: 'book_changed' };
    if (isConnectionLost(error)) return { studio, status: 'connection_lost', error: failureReason(error) };
    return { studio, status: 'failed', error: failureReason(error) };
  }
}

async function runBook(sql: PostgresJs, dryRun: boolean): Promise<RunBook> {
  if (dryRun) return { entries: buildSeedBook(await readMarketSeedItems(sql)), storedVersion: null };
  const stored = await rebuildSeedBook(sql);
  return { entries: stored.entries, storedVersion: stored.version };
}

export async function runSeed(db: MetraDb, sql: PostgresJs, options: { dryRun: boolean; orgIds: string[] }): Promise<SeedRun> {
  const studios = await readStudios(sql, options.orgIds);
  const missing = options.orgIds.filter((id) => !studios.some((studio) => studio.id === id));
  if (missing.length > 0) throw new Error(`no organization ${missing.join(', ')}`);
  const book = await runBook(sql, options.dryRun);
  const outcomes: StudioOutcome[] = [];
  for (const studio of studios) {
    const stopped = outcomes.some(stoppedBy);
    outcomes.push(stopped ? { studio, status: 'not_reached' } : await seedOne(db, sql, studio, book, options.dryRun));
  }
  return { marketItems: book.entries.length, outcomes };
}
