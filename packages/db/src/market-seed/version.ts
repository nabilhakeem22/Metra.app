// Which stored seed book a seed was planned from: a digest of every row of
// market_seed_book that a seed reads or writes from, in the book's order. The
// owner's CLI reads it in the transaction that rebuilds the book and again in
// each studio's transaction, after the studio holds the book (holdForSeed): a
// publish or withdrawal in between changes the digest, and that studio is not
// written. A rebuild that stores the same book keeps the same digest, so it
// stops nothing. `built_at` is left out for exactly that reason.
//
// ONE query text for both connections (postgres.js in the CLI's rebuild,
// drizzle in the studio's RLS transaction), so the two digests are computed
// alike. It takes no parameter.
export const SEED_BOOK_VERSION_QUERY = `
  select md5(coalesce(string_agg(row(item_id, position, code, name_ar, name_en, name_forms, status, unit, unit_cost, unit_price,
                                     leaf_key, leaf_name_ar, leaf_name_en, top_name_ar, top_name_en)::text, E'\\n' order by position), '')) as version
    from market_seed_book`;
