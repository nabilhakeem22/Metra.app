// The one lock every write of market items into a studio's price book takes
// first: the seed (./seed-core.ts) and "add to my price book" (./core.ts). So a
// seed and an add, or two adds, of the same studio run one after the other, and
// the second sees what the first created (an item already linked is never
// created twice), and neither runs while a publish rebuilds the seed book.
import type { MetraDb } from '@metra/db';
import { holdForSeed } from '@metra/db/market-seed/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import { ActionError } from '@/lib/actions/result';

const LOCK_NOT_AVAILABLE = '55P03';

/**
 * Hold the seed book and the studio (holdForSeed, the transaction's first
 * statement). A lock timeout there is a wait behind a publish or withdrawal
 * rebuilding the book (it holds it exclusively for seconds over a slow link),
 * or behind another seed or add of this studio: this transaction has written
 * nothing, so it is answered `market_book_busy` (try again shortly), never the
 * `uncertain` a lock timeout gets elsewhere.
 */
export async function holdStudioBookOrBusy(tx: MetraDb): Promise<void> {
  try {
    await holdForSeed(tx);
  } catch (error) {
    if (sqlstateOf(error) === LOCK_NOT_AVAILABLE) throw new ActionError('market_book_busy');
    throw error;
  }
}
