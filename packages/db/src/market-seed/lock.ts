// One market write at a time, whoever runs it: market:publish and
// market:withdraw take this transaction-scoped advisory lock EXCLUSIVELY, and
// so does the seed book's rebuild. A seed holds it SHARED while it plans from
// the stored book and writes from it, so the book cannot change in between.
export const MARKET_WRITE_LOCK = 'metra.market.publish';

/** One seed of a studio at a time: with the studio's org id, the two keys of its transaction lock (./db.ts holdForSeed). */
export const STUDIO_SEED_LOCK = 'metra.market.seed-studio';
