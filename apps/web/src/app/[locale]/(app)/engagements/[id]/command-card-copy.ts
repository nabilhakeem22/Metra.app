'use client';

import { useTranslations } from 'next-intl';
import type { CommandCardView } from '@/lib/engagements/command-card';
import { resolveStageAction, type StageActor } from '@/lib/engagements/stage-action';
import type { DesignState } from '@/lib/engagements/states';

/** What the card SAYS: who is next, in one line, and why, in one more. */
export interface CommandCardCopy {
  headline: string;
  hint: string | null;
  /** Null in the closed and ready modes, where the registry has no row. */
  actor: StageActor | null;
}

/**
 * The card names the LITERAL ACT of this stage rather than announcing that a step
 * exists — the registry is the one place that mapping lives, and it guarantees a
 * row for every state, so a rescue entry into an unusual stage can never render a
 * blank hero. `ready` and `closed` already name their own act (one interpolates
 * the phase, one has nothing to name), so the registry returns null there and the
 * existing copy stands.
 *
 * The BLOCKER, not just the state: `final_approval` can be held by either the
 * cost-range acknowledgement or the as-built reconciliation, and naming the wrong
 * one is worse than naming neither.
 */
export function useCommandCardCopy(options: {
  state: DesignState;
  view: CommandCardView;
  closed: boolean;
}): CommandCardCopy {
  const t = useTranslations('engagements');
  const tcmd = useTranslations('engagements.command');
  const tsa = useTranslations('engagements.stageAction');
  const { state, view, closed } = options;

  const stageAction = resolveStageAction(state, view.mode, view.primaryBlocker);
  // Order matters and encodes the invariant: `closed` is checked first because the
  // registry returns null there too, then the two BLOCKED modes (where a row is
  // guaranteed), and `ready` last. No optional chaining — a null here would be a
  // bug in the registry, not a case to render around.
  const headline = closed
    ? tcmd('closedHeadline')
    : stageAction
      ? tsa(`${stageAction.actor}.${stageAction.key}.headline`)
      : tcmd('readyHeadline', { phase: t(`state.${view.nextPhaseState ?? state}`) });
  const hint = stageAction
    ? // Names who is waiting and what unlocks, one clause each. It still does NOT
      // name the blocking guard: the checklist below lists that exact guard
      // verbatim with an unmet marker, and a third copy of the same sentence is
      // precisely what the old generic hint was.
      tsa(`${stageAction.actor}.${stageAction.key}.sub`)
    : view.mode === 'ready'
      ? tcmd('readyHint')
      : null;

  return { headline, hint, actor: stageAction?.actor ?? null };
}
