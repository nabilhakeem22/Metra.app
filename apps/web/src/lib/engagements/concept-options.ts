// The concept-option cap — the client-safe mirror of what the `optionsReady`
// guard enforces. PURE and CLIENT-SAFE: no I/O, no `server-only`, no db runtime
// (the `@metra/db` import is type-only and erases), so the command card and the
// inline dropzone can both import it without dragging the guard engine into a
// client chunk.
//
// WHY THIS EXISTS: `optionsReady` passes only at 2–4 `concept_option` artifacts,
// and artifacts are APPEND-ONLY (recording one IS attesting it — see
// artifacts.ts), so there is no delete path back. A 5th upload therefore puts the
// engagement in a state the studio cannot leave. The UI must make the cap
// UNREACHABLE rather than try to recover from it.
//
// `concept-options.test.ts` pins both bounds against the real guard, so changing
// the guard's range without changing these fails loudly instead of silently
// re-opening the trap.
import type { EngagementArtifactKind } from '@metra/db';

/** Fewest concept options that satisfy `optionsReady` — one option is no choice. */
export const CONCEPT_OPTION_MIN = 2;
/** Most concept options `optionsReady` accepts — beyond this the decision dilutes. */
export const CONCEPT_OPTION_MAX = 4;

/**
 * How many concept options an engagement already carries. Counts EVERY
 * `concept_option` artifact, file-bearing or not, because that is exactly what
 * the guard counts — a fileless one recorded through the artifact panel still
 * consumes a slot, so the UI must see it too or the cap could be overshot.
 */
export function countConceptOptions(
  artifacts: readonly { kind: EngagementArtifactKind }[],
): number {
  return artifacts.filter((artifact) => artifact.kind === 'concept_option').length;
}

/** True once another concept option would push the engagement past the cap. */
export function conceptOptionsAtCapacity(count: number): boolean {
  return count >= CONCEPT_OPTION_MAX;
}
