// Shared id validation for the Public API (v1). Pure.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string. Detail routes 404 on anything else so a
 * malformed id never reaches the DB (which would raise 22P02 -> a 500). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
