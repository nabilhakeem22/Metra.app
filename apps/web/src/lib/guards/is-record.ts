/**
 * PURE and CLIENT-SAFE: no imports, no `server-only`, no 'use client'.
 *
 * The one narrowing every reader of an untyped JSONB transition payload needs
 * before it may index into the value. It had been declared privately twice, in
 * two files that read the SAME payloads.
 */

/**
 * Narrow `value` to an indexable object.
 *
 * Note what this deliberately does NOT exclude: an array is an object, and so is
 * a Date. Both narrow to `Record<string, unknown>` here, and that is correct for
 * the call sites — they immediately read a NAMED property, which is `undefined`
 * on an array and then fails its own shape check. Excluding arrays would add a
 * branch that no caller can observe. `null` is excluded, because `typeof null`
 * is 'object' and indexing it throws.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
