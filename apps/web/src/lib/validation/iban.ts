/**
 * The ISO 13616 checksum of an IBAN. PURE and CLIENT-SAFE.
 *
 * The four leading characters move to the end, every letter becomes its two
 * digits (A = 10 ... Z = 35), and the result read as one number must be 1
 * modulo 97. It catches every single mistyped character and almost every pair
 * of swapped neighbours: the mistakes that would send a client's payment to an
 * account nobody at the studio owns. `iban` must already be upper-case
 * letters and digits only; anything else answers false.
 */
export function ibanChecksumHolds(iban: string): boolean {
  if (!/^[A-Z0-9]{5,}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
