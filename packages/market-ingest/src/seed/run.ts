// `market:seed-price-books`: fill every studio's price book (or the --org ones)
// from the published market book. ONE TRANSACTION PER STUDIO: a studio is
// seeded completely or not at all, one studio's failure (a code a studio typed
// in the same second, say) cannot undo another's, each transaction holds its
// locks for one studio only, and a re-run (idempotent) retries just the
// studios that failed. Returns one result per studio, in organization order.
//
// The seed book is built once for the whole run. A real run also STORES it
// (market_seed_book, behind the market write lock) and holds it until the run
// ends: its items are written by reference to that stored book, and the app
// seeds new studios from exactly the book this run used. A dry run writes
// nothing and holds nothing.
import type { MetraDb } from '@metra/db';
import { buildSeedBook, type SeedBookEntry, type SeedPlan } from '@metra/db/market-seed';
import type { PostgresJs } from '../db/connection';
import { rebuildAndHoldSeedBook, releaseSeedBookHold } from './book-store';
import { failureReason } from './failure';
import { readActor, readMarketSeedItems, readStudios, type Studio } from './read';
import { seedStudio } from './write';

export type StudioOutcome =
  | { studio: Studio; status: 'planned' | 'seeded'; actor: { userId: string; role: 'owner' | 'admin' }; plan: SeedPlan }
  | { studio: Studio; status: 'no_actor' }
  | { studio: Studio; status: 'failed'; error: string };

export interface SeedRun {
  marketItems: number;
  outcomes: StudioOutcome[];
}

/** One studio's outcome: no actor, its plan (written unless a dry run), or the reason it failed. */
async function seedOne(db: MetraDb, sql: PostgresJs, studio: Studio, book: SeedBookEntry[], dryRun: boolean): Promise<StudioOutcome> {
  const actor = await readActor(sql, studio.id);
  if (actor === null) return { studio, status: 'no_actor' };
  try {
    const plan = await seedStudio(db, { orgId: studio.id, ...actor }, book, dryRun);
    return { studio, status: dryRun ? 'planned' : 'seeded', actor, plan };
  } catch (error) {
    return { studio, status: 'failed', error: failureReason(error) };
  }
}

export async function runSeed(db: MetraDb, sql: PostgresJs, options: { dryRun: boolean; orgIds: string[] }): Promise<SeedRun> {
  const studios = await readStudios(sql, options.orgIds);
  const missing = options.orgIds.filter((id) => !studios.some((studio) => studio.id === id));
  if (missing.length > 0) throw new Error(`no organization ${missing.join(', ')}`);
  const book = options.dryRun ? buildSeedBook(await readMarketSeedItems(sql)) : await rebuildAndHoldSeedBook(sql);
  try {
    const outcomes: StudioOutcome[] = [];
    for (const studio of studios) outcomes.push(await seedOne(db, sql, studio, book, options.dryRun));
    return { marketItems: book.length, outcomes };
  } finally {
    if (!options.dryRun) await releaseSeedBookHold(sql);
  }
}
