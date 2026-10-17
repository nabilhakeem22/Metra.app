// One market write at a time, whoever runs it: market:publish and
// market:withdraw take this transaction-scoped advisory lock EXCLUSIVELY, and
// so does the seed book's rebuild. A seed holds it SHARED while it plans from
// the stored book and writes from it, so the book cannot change in between.
export const MARKET_WRITE_LOCK = 'metra.market.publish';
