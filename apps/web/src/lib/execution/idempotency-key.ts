// The idempotency key of an execution ledger write (a payment, a site
// measurement) as the ledger keeps it. PURE: the cores canonicalise what
// arrived before they judge it.

/**
 * Trimmed and lower-case, so the upper-case spelling of a uuid is the same key
 * and never a second row; anything that is not a string is no key at all.
 */
export function canonicalIdempotencyKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}
