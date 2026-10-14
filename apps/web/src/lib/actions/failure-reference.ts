// The short code an unknown failure hands the person, and writes next to its
// log line, so support can find one from the other.
//
// Crockford base32 (no I, L, O, U): read aloud or retyped from a screenshot, it
// cannot be confused, and with no hyphen it stays one left-to-right run inside
// an Arabic sentence. 8 characters = 40 bits, plenty to tell apart the failures
// of one live `wrangler tail`.

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const REFERENCE_LENGTH = 8;

/** A fresh reference; works on Workers and Node (Web Crypto). */
export function newFailureReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(REFERENCE_LENGTH));
  // 256 is a multiple of 32, so masking the low 5 bits is unbiased.
  return Array.from(bytes, (byte) => CROCKFORD_ALPHABET[byte & 31]).join('');
}
