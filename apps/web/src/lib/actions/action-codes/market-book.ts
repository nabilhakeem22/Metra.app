// Error codes of the market price book's studio actions: adding a market item
// to the studio's price book and linking a price-book item to one. Pure (no
// server-only deps). The full union is `ActionCode` in `lib/actions/result.ts`.
export type MarketBookActionCode =
  // No such market item, none the studio can see (no published price), or one
  // the ministry no longer prices (discontinued).
  | 'market_item_not_found'
  // The market item's unit has no studio unit (bag, pack, 1000 bricks), or not
  // the price-book item's unit: a guide price is never compared across units.
  | 'market_unit_incompatible'
  // The studio already has an active price-book item linked to this market
  // item (an earlier add, or the seed): a second one is never created.
  | 'market_item_already_added'
  // No published month ever priced this item (every month suspended), so it
  // has no cost to start from: the seed skips it too.
  | 'market_item_unpriced'
  // Said under a name field: the studio's own item {code} already has this
  // name (the seed's name-clash rule), so the add asks for another one.
  | 'name_taken';
