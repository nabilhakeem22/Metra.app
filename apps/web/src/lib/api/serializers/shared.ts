// Shared helpers for the Public API (v1) serializers. Pure. Public shapes use
// snake_case keys, UUID ids, Western-numeral strings, and money as scale-4
// numeric strings (passed straight through from the DB numeric(18,4)).

/** Normalize a timestamptz (Date or ISO string) to an ISO-8601 string. */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}
