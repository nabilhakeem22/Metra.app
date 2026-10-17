// Filling a studio's price book from the official market book: the app's half
// of `market:seed-price-books`. The rules, the plan and the one write are the
// CLI's own (@metra/db/market-seed), read from the stored seed book, so a
// studio seeded at sign-up or from its empty price book gets exactly what the
// owner's command would give it: the same sections, names, codes, units,
// skips, cost, cost x 1.05 and market link. Idempotent: an item already
// linked is skipped, so a second load adds nothing.
import type { MetraDb } from '@metra/db';
import { canClashByName, planSeed } from '@metra/db/market-seed';
import { readSeedBook, readStudioBook, writeSeedPlan } from '@metra/db/market-seed/db';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

/** Marks the audit rows of each app path, as `market:seed-price-books` marks the CLI's. */
export const SEED_SOURCES = {
  signup: 'market:seed-on-signup',
  emptyPriceBook: 'market:seed-from-price-book',
} as const;

export interface MarketSeedSummary {
  /** False when no bulletin is published (the seed book is empty): nothing to load yet. */
  published: boolean;
  sections: number;
  items: number;
}

/** The seed, inside the caller's RLS transaction for the studio. */
export async function seedStudioPriceBook(tx: MetraDb, source: string): Promise<MarketSeedSummary> {
  const studio = await readStudioBook(tx);
  const book = await readSeedBook(tx, canClashByName(studio));
  if (book.length === 0) return { published: false, sections: 0, items: 0 };
  const written = await writeSeedPlan(tx, planSeed(book, studio), source);
  return { published: true, ...written };
}

/** The empty price book's "load the market price book": owners and admins (price_book create). */
export async function loadMarketPriceBookCore(ctx: OrgContext): Promise<ActionResult & { data?: MarketSeedSummary }> {
  return mutateInOrg(ctx, { capability: 'price_book', action: 'create' }, (tx) => seedStudioPriceBook(tx, SEED_SOURCES.emptyPriceBook));
}
