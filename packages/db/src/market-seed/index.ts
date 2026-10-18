// The price-book seed's rules, ONE implementation for the owner's CLI
// (`market:seed-price-books`, packages/market-ingest) and the app (a new
// studio at sign-up, the empty price book's button). PURE: no database, no
// next/*; the reads and the one write are in ./db.ts (`@metra/db/market-seed/db`).
export { buildSeedBook } from './book';
export { comparisonForm } from './compare';
export { MARKET_WRITE_LOCK, STUDIO_SEED_LOCK } from './lock';
export { atPriceBookScale, withFivePercentMargin } from './margin';
export { ITEM_CODE_PREFIX, SECTION_KEY_PREFIX, itemCode, sectionKey } from './naming';
export { normalizeArabic, toWesternDigits } from './normalize';
export { canClashByName, planSeed, planSeedRefs } from './plan';
export * from './types';
export { SEED_BOOK_VERSION_QUERY } from './version';
