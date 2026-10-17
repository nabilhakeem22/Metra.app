// One studio, inside ITS OWN RLS transaction (withOrgContext: metra_app, the
// studio's org and actor in the GUCs): read what the studio has, plan it
// against the seed book, and, unless it is a dry run, write the plan. The
// plan and the write are the app's own (@metra/db/market-seed), so a studio
// seeded here and one seeded at sign-up get the same rows and audit trail.
import { withOrgContext, type MetraDb } from '@metra/db';
import { planSeed, type SeedBookEntry, type SeedPlan } from '@metra/db/market-seed';
import { readStudioBook, writeSeedPlan } from '@metra/db/market-seed/db';

export interface StudioContext {
  orgId: string;
  userId: string;
  role: 'owner' | 'admin';
}

/** Marks every audit row this command writes, so its creates read apart from a studio's own. */
export const SEED_SOURCE = 'market:seed-price-books';

/** The studio's plan; written in the same transaction unless `dryRun`. */
export async function seedStudio(db: MetraDb, studio: StudioContext, book: SeedBookEntry[], dryRun: boolean): Promise<SeedPlan> {
  return withOrgContext(db, studio, async (tx) => {
    const plan = planSeed(book, await readStudioBook(tx));
    if (!dryRun) await writeSeedPlan(tx, plan, SEED_SOURCE);
    return plan;
  });
}
