// One market write at a time, whoever runs it: publish, withdraw, and the
// seed book's rebuild all take this transaction-scoped advisory lock.
export const MARKET_WRITE_LOCK = 'metra.market.publish';
