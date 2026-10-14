/**
 * A state the code believes impossible. Throws a plain Error whose message is
 * the developer's own label (no user data, so safe to log); inside a mutation it
 * reaches the unclassified tail, which logs it with a reference and answers
 * `generic`. Loud, instead of a quiet coded refusal nobody can act on.
 */
export function invariant(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}
