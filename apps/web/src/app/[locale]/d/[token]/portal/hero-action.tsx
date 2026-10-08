'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { isConceptVerb } from '@/lib/engagements/concept-choice-outcome';
import type { HeroGroup } from '@/lib/engagements/portal-hero';
import { recordDeliveryAction, respondToDeliveryConcept } from '../actions';
import {
  answerOfConceptOutcome,
  answerOfSignal,
  type HeroAnswer,
  type HeroConfirmedState,
  type HeroError,
} from './hero-answer';
import { HeroConfirmed, type HeroOutcome } from './hero-confirmed';

interface HeroButton {
  verb: string;
  /** Key under `delivery.hero.<group>` for the button label. */
  labelKey: 'approve' | 'changes' | 'acknowledge';
  outcome: HeroOutcome;
  variant: 'default' | 'ghost';
}

/**
 * The one-action-never-a-menu button set per group: a single primary CTA with a
 * quiet "request changes" beside it (handoff has only the confirm). The verbs are
 * the SDF-computed client-action tokens; recording either of a concept/design pair
 * drops BOTH from the next read (server-side), so confirming one ends the group.
 */
const GROUP_BUTTONS: Record<HeroGroup, HeroButton[]> = {
  concept: [
    { verb: 'approve_concept', labelKey: 'approve', outcome: 'approved', variant: 'default' },
    { verb: 'request_concept_changes', labelKey: 'changes', outcome: 'changes', variant: 'ghost' },
  ],
  design: [
    { verb: 'approve_design', labelKey: 'approve', outcome: 'approved', variant: 'default' },
    { verb: 'request_design_changes', labelKey: 'changes', outcome: 'changes', variant: 'ghost' },
  ],
  handoff: [
    { verb: 'acknowledge_handoff', labelKey: 'acknowledge', outcome: 'acknowledged', variant: 'default' },
  ],
};

/**
 * The actionable hero: the plain-language CTA for its group, a note field, and
 * one button per verb the client is actually OFFERED (`clientActions`). One
 * primary button, never a menu. A concept verb answers from the decision SAVED
 * on file (a repeat shows that one, B12); a design or handover verb confirms
 * the tapped verb.
 */
export function ActionHero({
  token,
  group,
  clientActions,
}: {
  token: string;
  group: HeroGroup;
  clientActions: readonly string[];
}) {
  const tHero = useTranslations('delivery.hero');
  const tGroup = useTranslations(`delivery.hero.${group}`);
  const tActions = useTranslations('delivery.actions');
  const tPicker = useTranslations('delivery.conceptPicker');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState<HeroConfirmedState | null>(null);
  const [error, setError] = useState<HeroError | null>(null);
  const buttons = GROUP_BUTTONS[group].filter((button) => clientActions.includes(button.verb));

  async function answerOf(verb: string, outcome: HeroOutcome): Promise<HeroAnswer> {
    if (isConceptVerb(verb)) {
      return answerOfConceptOutcome(await respondToDeliveryConcept(token, verb, note));
    }
    return answerOfSignal(await recordDeliveryAction(token, verb, note), outcome);
  }

  function submit(verb: string, outcome: HeroOutcome) {
    setError(null);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const answer = await answerOf(verb, outcome);
        if ('confirmed' in answer) return setConfirmed(answer.confirmed);
        setError(answer.error);
        if (answer.refresh) router.refresh();
      } catch {
        setError('generic');
      }
    });
  }

  if (confirmed) {
    return (
      <HeroConfirmed
        group={group}
        outcome={confirmed.outcome}
        studioNotified={confirmed.studioNotified}
        chosenLetter={confirmed.chosenLetter}
      />
    );
  }

  return (
    <section className="space-y-3 rounded-panel border-2 border-primary/25 bg-background p-5 shadow-md">
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-primary/10 px-2.5 py-1 text-caption font-bold text-primary ltr:uppercase ltr:tracking-wide">
        <span aria-hidden>●</span>
        {tHero('readyTag')}
      </span>
      <h2 className="text-heading font-semibold">{tGroup('headline')}</h2>
      <p className="text-body text-muted-foreground">{tGroup('body')}</p>
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        rows={2}
        dir="auto"
        placeholder={tActions('notePlaceholder')}
      />
      <div className="flex flex-col gap-2">
        {buttons.map((button) => (
          <Button
            key={button.verb}
            variant={button.variant}
            disabled={pending}
            onClick={() => submit(button.verb, button.outcome)}
          >
            {pending && button.variant === 'default' && (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            )}
            {tGroup(button.labelKey)}
          </Button>
        ))}
      </div>
      {error && (
        <p className="text-body text-destructive" role="alert">
          {error === 'changed' || error === 'movedOn' ? tPicker(error) : tActions(`error.${error}`)}
        </p>
      )}
    </section>
  );
}
