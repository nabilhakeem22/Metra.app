// `npm run market:rebuild-seed-book`: rebuild the stored seed book
// (market_seed_book) from the PUBLISHED market book, and seed no studio. The
// owner's step right after 0062 (the book starts empty; until it is built the
// app can seed nothing), and a repair if the book is ever in doubt. Publish
// and withdraw rebuild it on their own.
import { parseArgs } from 'node:util';
import { withDatabase } from '../db/connection';
import { rebuildSeedBook } from '../seed/book-store';

export async function rebuildSeedBookCommand(argv: string[]): Promise<number> {
  parseArgs({ args: argv, options: {}, strict: true });
  const book = await withDatabase(rebuildSeedBook);
  console.log(`market:rebuild-seed-book: the seed book holds ${book.entries.length} published market item(s); no studio was seeded`);
  return 0;
}
