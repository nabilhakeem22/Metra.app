// Filling a studio's price book from the official market book: the app's half
// of `market:seed-price-books`. The rules, the plan and the one write are the
// CLI's own (@metra/db/market-seed), read from the stored seed book, so a
// studio seeded right after sign-up or from its empty price book gets exactly
// what the owner's command would give it: the same sections, names, codes,
// units, skips, cost, cost x 1.05 and market link. Idempotent: an item
// already linked is skipped, and a second seed (or an add) of the same studio
// waits for the first (./studio-hold.ts), so a repeat adds nothing.
import type { MetraDb } from '@metra/db';
import { canClashByName, planSeedRefs } from '@metra/db/market-seed';
import { isMarketPublished, readSeedBook, readStudioBook, writeSeedPlan, type SeedWritten } from '@metra/db/market-seed/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import { sql } from 'drizzle-orm';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { holdStudioBookOrBusy } from './studio-hold';

/** Marks the audit rows of each app path, as `market:seed-price-books` marks the CLI's. Chosen on the server. */
export const SEED_SOURCES = {
  signup: 'market:seed-on-signup',
  emptyPriceBook: 'market:seed-from-price-book',
} as const;

/** A studio this young with nothing in its price book is the one just signed up. */
const NEW_STUDIO_WINDOW = '1 hour';

export interface MarketSeedSummary {
  /** `ready`: the stored book was read; `preparing`: a bulletin is published, its book not built yet; `unpublished`: no bulletin. */
  book: 'ready' | 'preparing' | 'unpublished';
  sections: number;
  items: number;
}

const UNIQUE_VIOLATION = '23505';

/**
 * The write, in a savepoint (a nested transaction: postgres.js fails the whole
 * transaction on ANY failed statement unless it ran in its own savepoint
 * scope). A duplicate, from a seed that won a race the studio lock did not
 * see, means nothing is left to add.
 */
async function writeOnce(tx: MetraDb, write: (savepoint: MetraDb) => Promise<SeedWritten>): Promise<SeedWritten> {
  try {
    return await tx.transaction((savepoint) => write(savepoint as unknown as MetraDb));
  } catch (error) {
    if (sqlstateOf(error) !== UNIQUE_VIOLATION) throw error;
    return { sections: 0, items: 0 };
  }
}

async function isNewStudio(tx: MetraDb): Promise<boolean> {
  const rows = (await tx.execute(sql`
    select created_at > now() - ${NEW_STUDIO_WINDOW}::interval as young
      from organizations where id = current_setting('app.current_org_id', true)::uuid`)) as unknown as Array<{ young: boolean }>;
  return rows[0]?.young === true;
}

/** The seed inside the caller's RLS transaction for the studio; `source` is decided from what the studio already has. */
async function seedStudioPriceBook(tx: MetraDb, sourceFor: (studioIsEmpty: boolean) => Promise<string>): Promise<MarketSeedSummary> {
  await holdStudioBookOrBusy(tx);
  const studio = await readStudioBook(tx);
  const book = await readSeedBook(tx, canClashByName(studio));
  if (book.length === 0) return { book: (await isMarketPublished(tx)) ? 'preparing' : 'unpublished', sections: 0, items: 0 };
  const source = await sourceFor(studio.items.length === 0);
  const written = await writeOnce(tx, (savepoint) => writeSeedPlan(savepoint, planSeedRefs(book, studio), source));
  return { book: 'ready', ...written };
}

function seedCore(ctx: OrgContext, sourceFor: (tx: MetraDb, studioIsEmpty: boolean) => Promise<string>): Promise<ActionResult & { data?: MarketSeedSummary }> {
  return mutateInOrg(ctx, { capability: 'price_book', action: 'create' }, (tx) => seedStudioPriceBook(tx, (empty) => sourceFor(tx, empty)));
}

/** The empty price book's "load the market price book" (owners and admins). */
export function loadMarketPriceBookCore(ctx: OrgContext): Promise<ActionResult & { data?: MarketSeedSummary }> {
  return seedCore(ctx, async () => SEED_SOURCES.emptyPriceBook);
}

/**
 * The seed the onboarding wizard requests right after sign-up (its own
 * request: a Worker's CPU budget is per request). Marked as the sign-up's only
 * for a studio under an hour old whose price book is empty; any other call is
 * a load like the button's, and marked so.
 */
export function seedNewStudioCore(ctx: OrgContext): Promise<ActionResult & { data?: MarketSeedSummary }> {
  return seedCore(ctx, async (tx, empty) => (empty && (await isNewStudio(tx)) ? SEED_SOURCES.signup : SEED_SOURCES.emptyPriceBook));
}
