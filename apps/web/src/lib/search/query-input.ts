/**
 * A typed search as a query may run it: without U+0000 (Postgres refuses it in
 * text, SQLSTATE 22021, so it would fail the search instead of matching
 * nothing), then cut to `maxLength`. Longer input is cut, not refused. Pure and
 * client-safe.
 */
export function cleanSearchQuery(query: string, maxLength: number): string {
  return query.replaceAll(String.fromCharCode(0), '').slice(0, maxLength);
}
