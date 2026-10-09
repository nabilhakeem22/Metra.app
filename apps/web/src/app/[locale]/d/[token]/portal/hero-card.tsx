'use client';

import { answeredReview } from '@/lib/engagements/portal-answered';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import type { HeroGroup, HeroView } from '@/lib/engagements/portal-hero';
import type { PortalStageKey } from '@/lib/engagements/portal-stage';
import { CalmHero } from './calm-hero';
import { ConceptOptionPicker } from './concept-option-picker';
import { ActionHero } from './hero-action';
import type { HeroConfirmedState } from './hero-answer';
import { HeroConfirmed } from './hero-confirmed';

/** The fewest released options that make a choice (one option is no choice). */
const PICKER_MIN_OPTIONS = 2;

/** The client's last confirmed answer on this page, and the hero it answered. */
export interface HeroLastAnswer {
  group: HeroGroup;
  confirmed: HeroConfirmedState;
}

/**
 * The hero: the single "what needs you now" surface. At the concept review, with
 * at least two released options and the approval still open, it is the option
 * picker; in any other actionable state it is the group's CTA (./hero-action.tsx);
 * otherwise the calm card (./calm-hero.tsx), which says what the client
 * answered when they have answered the stage's review.
 *
 * A confirmed answer stays on screen in place of the hero, before and after
 * the refresh that follows it (it already says what was done and what comes
 * next, so the calm card under it would only repeat it). A NEW request (another
 * group) replaces it.
 */
export function HeroCard({
  token,
  hero,
  stageKey,
  clientActions,
  conceptOptions,
  conceptChoice,
  conceptDecision,
  lastAnswer,
  onAnswered,
}: {
  token: string;
  hero: HeroView;
  stageKey: PortalStageKey;
  clientActions: PublicDelivery['clientActions'];
  conceptOptions: PublicDelivery['conceptOptions'];
  conceptChoice: PublicDelivery['conceptChoice'];
  conceptDecision: PublicDelivery['conceptDecision'];
  lastAnswer: HeroLastAnswer | null;
  onAnswered: (answer: HeroLastAnswer) => void;
}) {
  const asked = hero.kind === 'action' ? hero.group : undefined;
  if (lastAnswer && (!asked || asked === lastAnswer.group)) {
    return <HeroConfirmed group={lastAnswer.group} {...lastAnswer.confirmed} />;
  }
  if (!asked) {
    return (
      <CalmHero
        kind={hero.kind}
        stageKey={stageKey}
        answered={answeredReview({ stageKey, clientActions, conceptDecision, conceptChoice })}
        chosenLetter={conceptChoice?.letter ?? null}
      />
    );
  }
  const answered = (confirmed: HeroConfirmedState) => onAnswered({ group: asked, confirmed });
  const picksAnOption =
    asked === 'concept' &&
    clientActions.includes('approve_concept') &&
    conceptOptions.length >= PICKER_MIN_OPTIONS;
  if (picksAnOption) {
    return (
      <ConceptOptionPicker
        token={token}
        options={conceptOptions}
        canRequestChanges={clientActions.includes('request_concept_changes')}
        onAnswered={answered}
      />
    );
  }
  return <ActionHero token={token} group={asked} clientActions={clientActions} onAnswered={answered} />;
}
