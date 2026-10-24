// The step engine's input checks. PURE and CLIENT-SAFE. TypeScript already
// refuses these inputs; the checks are for an untyped path (a JSON payload, a
// cast), so a bad input throws a developer-only error instead of drawing a
// wrong rail or answering `undefined`.

/** `value` is one of `known`, else a developer-only error naming `what`. */
export function assertOneOf<T extends string>(known: readonly T[], value: string, what: string): asserts value is T {
  // developer-only: the message names what was expected, a constant; the refused value is never in it.
  if (!(known as readonly string[]).includes(value)) throw new Error(`unknown ${what}`);
}

/** The entry of a total table, refusing a key the table does not have. */
export function entryOf<K extends string, V>(table: Readonly<Record<K, V>>, key: K, what: string): V {
  assertOneOf(Object.keys(table) as K[], key, what);
  return table[key];
}

/** A count is a whole number, zero or more. */
export function assertCount(value: number, what: string): void {
  // developer-only: the message names a fact's field, a constant; its value is never in it.
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} is not a count`);
}
