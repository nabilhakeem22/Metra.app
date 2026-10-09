'use client';

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
 * otherwise the calm card (./calm-hero.tsx).
 *
 * A confirmed answer stays on screen: until the refresh lands (the props still
 * offer the same group) the confirmation stands in place of the buttons, and
 * once the server says nothing is asked any more it sits above the calm hero.
 * A NEW request (another group) replaces it.
 */
export function HeroCard({
  token,
  hero,
  stageKey,
  clientActions,
  conceptOptions,
  conceptChoice,
  lastAnswer,
  onAnswered,
}: {
  token: string;
  hero: HeroView;
  stageKey: PortalStageKey;
  clientActions: PublicDelivery['clientActions'];
  conceptOptions: PublicDelivery['conceptOptions'];
  conceptChoice: PublicDelivery['conceptChoice'];
  lastAnswer: HeroLastAnswer | null;
  onAnswered: (answer: HeroLastAnswer) => void;
}) {
  const asked = hero.kind === 'action' ? hero.group : undefined;
  const calm = (
    <CalmHero kind={hero.kind} stageKey={stageKey} chosenLetter={conceptChoice?.letter ?? null} />
  );

  if (lastAnswer && (!asked || asked === lastAnswer.group)) {
    const confirmation = <HeroConfirmed group={lastAnswer.group} {...lastAnswer.confirmed} />;
    if (asked) return confirmation;
    return (
      <div className="space-y-3">
        {confirmation}
        {calm}
      </div>
    );
  }

  if (!asked) return calm;
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
