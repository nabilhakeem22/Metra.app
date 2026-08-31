// Design-Engagement Machine — WHICH revision allowance each revision edge spends.
// PURE and CLIENT-SAFE: no db import, no `server-only`, no 'use client'. It exists
// because the two revision edges draw on two INDEPENDENT counters — the concept
// self-loop (`requestRevision`) spends `revision_count` against `free_revision_n`,
// the 3D loop (`designChangeRaised`) spends `design_revision_count` against
// `free_design_revision_n` — and BOTH the server side-effect (`revisions.ts`) and
// the cockpit's revision form must pick the same pair for the same trigger. One
// declaration, imported by both, so they can never drift apart.

/** The two revision edges. Both carry the same payload, each spends its OWN pair. */
export type RevisionTrigger = 'requestRevision' | 'designChangeRaised';

const REVISION_TRIGGERS: ReadonlySet<string> = new Set<RevisionTrigger>([
  'requestRevision',
  'designChangeRaised',
]);

/** Is this one of the two revision edges? Keeps the counter lookup total. */
export function isRevisionTrigger(trigger: string): trigger is RevisionTrigger {
  return REVISION_TRIGGERS.has(trigger);
}

/** Both counter/allowance pairs as the engagement header carries them. */
export interface RevisionAllowances {
  revisionCount: number;
  freeRevisionN: number;
  designRevisionCount: number;
  freeDesignRevisionN: number;
}

/** One trigger's pair: revisions already spent, and how many are free. */
export interface RevisionAllowance {
  count: number;
  free: number;
}

/** The counter/allowance pair `trigger` spends. */
export function revisionAllowanceFor(
  trigger: RevisionTrigger,
  allowances: RevisionAllowances,
): RevisionAllowance {
  return trigger === 'designChangeRaised'
    ? {
        count: allowances.designRevisionCount,
        free: allowances.freeDesignRevisionN,
      }
    : { count: allowances.revisionCount, free: allowances.freeRevisionN };
}

/**
 * Would the NEXT revision on this edge cross its free allowance (and therefore
 * require a change-order amount)? The server's rule is `count + 1 > free` on the
 * post-increment value; `count >= free` is the same statement read BEFORE the
 * increment, which is what the form has. The server re-checks — this only decides
 * whether the cockpit solicits the amount.
 */
export function revisionAmountRequired(
  trigger: RevisionTrigger,
  allowances: RevisionAllowances,
): boolean {
  const { count, free } = revisionAllowanceFor(trigger, allowances);
  return count >= free;
}
