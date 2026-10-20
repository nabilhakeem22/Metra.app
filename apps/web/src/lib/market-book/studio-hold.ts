// The one lock every write of market items into a studio's price book takes
// first: the seed (./seed-core.ts) and "add to my price book" (./core.ts). So a
// seed and an add, or two adds, of the same studio run one after the other, and
// the second sees what the first created (an item already linked is never
// created twice), and neither runs while a publish rebuilds the seed book.
import type { MetraDb } from '@metra/db';
import { MARKET_WRITE_LOCK, STUDIO_SEED_LOCK } from '@metra/db/market-seed';
import { holdForSeed } from '@metra/db/market-seed/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { ActionError } from '@/lib/actions/result';

const LOCK_NOT_AVAILABLE = '55P03';

/**
 * Hold the seed book and the studio (holdForSeed, the transaction's first
 * statement). A lock timeout there is a wait behind a publish or withdrawal
 * rebuilding the book (it holds it exclusively for its whole write),
 * or behind another seed or add of this studio: this transaction has written
 * nothing, so it is answered `market_book_busy` (try again shortly), never the
 * `uncertain` a lock timeout gets elsewhere. A coded answer is not logged
 * downstream, so this one leaves its own redacted line (R5): the locks waited
 * on and for how long, as the `uncertain` lock waits do.
 */
export async function holdStudioBookOrBusy(tx: MetraDb): Promise<void> {
  const started = Date.now();
  try {
    await holdForSeed(tx);
  } catch (error) {
    if (sqlstateOf(error) !== LOCK_NOT_AVAILABLE) throw error;
    console.warn('market_book_busy', { locks: [MARKET_WRITE_LOCK, STUDIO_SEED_LOCK], waitedMs: Date.now() - started, failure: loggableFailure(error) });
    throw new ActionError('market_book_busy');
  }
}
