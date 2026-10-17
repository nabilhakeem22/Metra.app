// Locale-free text order. staged.json is hashed, so its order must not depend
// on the ICU build of whichever machine ran the check.
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
