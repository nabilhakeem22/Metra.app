// One studio, inside ITS OWN RLS transaction (withOrgContext: metra_app, the
// studio's org and actor in the GUCs): hold the stored book, check it is the
// book the run planned from, read what the studio has, plan it, and, unless it
// is a dry run, write the plan. The plan and the write are the app's own
// (@metra/db/market-seed), so a studio seeded here and one seeded at sign-up
// get the same rows and audit trail.
import { withOrgContext, type MetraDb } from '@metra/db';
import { planSeed, type SeedBookEntry, type SeedPlan } from '@metra/db/market-seed';
import { holdForSeed, readSeedBookVersion, readStudioBook, writeSeedPlan } from '@metra/db/market-seed/db';

export interface StudioContext {
  orgId: string;
  userId: string;
  role: 'owner' | 'admin';
}

/** The book a run plans every studio from. */
export interface RunBook {
  entries: SeedBookEntry[];
  /** The stored book's digest at the rebuild; null for a dry run, which plans from the market tables and writes nothing. */
  storedVersion: string | null;
}

/** Marks every audit row this command writes, so its creates read apart from a studio's own. */
export const SEED_SOURCE = 'market:seed-price-books';

/** A publish or withdrawal changed the stored book after the run rebuilt it; the studio's transaction wrote nothing. */
export class SeedBookChangedError extends Error {
  constructor() {
    super('the stored seed book is not the one this run planned from');
    this.name = 'SeedBookChangedError';
  }
}

/** The studio's plan; written in the same transaction unless `dryRun`. */
export async function seedStudio(db: MetraDb, studio: StudioContext, book: RunBook, dryRun: boolean): Promise<SeedPlan> {
  return withOrgContext(db, studio, async (tx) => {
    await holdForSeed(tx);
    if (book.storedVersion !== null && (await readSeedBookVersion(tx)) !== book.storedVersion) throw new SeedBookChangedError();
    const plan = planSeed(book.entries, await readStudioBook(tx));
    if (!dryRun) await writeSeedPlan(tx, plan, SEED_SOURCE);
    return plan;
  });
}
