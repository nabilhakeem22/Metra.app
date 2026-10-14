// The shape of the cockpit's one write entry point (useEngagementAction), apart
// from the hook, so the forms that take it import a type and nothing else.
import type { ActionResult } from '@/lib/actions/result';
import type { HeldKeyTrigger } from '@/lib/engagements/held-act';

/**
 * A form that says its own refusals under its fields (the field-errors hook is one).
 * Given one, a failed answer or a rejection goes to it instead of the card's
 * error line, so a field error is said under the field and nowhere else.
 */
export interface RefusalSink {
  applyResult(result: ActionResult): boolean;
  applyRejection(rejection: unknown): void;
}

/**
 * Runs ONE server action with the idempotency key held for the act it belongs to
 * (0050). `trigger` names the CONTROL — the two money controls are not lifecycle
 * triggers and hold their keys under their own names (held-act.ts); `act`
 * describes WHICH act it was, where the name does not (see HeldKey.act). An edge
 * that needs no key passes neither and ignores the argument. `sink` is the form
 * the act was typed into, when there is one.
 */
export type RunAction = (
  fn: (idempotencyKey: string) => Promise<ActionResult>,
  trigger?: HeldKeyTrigger,
  act?: string,
  sink?: RefusalSink,
) => void;
