'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { isConceptVerb } from '@/lib/engagements/concept-choice-outcome';
import type { HeroGroup } from '@/lib/engagements/portal-hero';
import { recordDeliveryAction, respondToDeliveryConcept } from '../actions';
import { ChangesNote } from './changes-note';
import { ConfirmActDialog } from './confirm-act-dialog';
import {
  answerOfConceptOutcome,
  answerOfSignal,
  type HeroAnswer,
  type HeroConfirmedState,
  type HeroError,
} from './hero-answer';
import { GROUP_BUTTONS, type HeroButton } from './hero-buttons';
import { HeroErrorText } from './hero-error';
import type { HeroOutcome } from './hero-confirmed';

/**
 * The actionable hero: the plain-language CTA for its group, a note field, and
 * one button per verb the client is actually OFFERED (`clientActions`). One
 * primary button, never a menu. Approving and confirming the handover ask
 * first (ConfirmActDialog; Cancel sends nothing); a request for changes needs a
 * note. A concept verb answers from the decision SAVED on file (a repeat shows
 * that one, B12); a design or handover verb confirms the tapped verb. A
 * confirmed answer goes UP (`onAnswered`): the command card keeps it on screen
 * across the refresh that follows.
 */
export function ActionHero({
  token,
  group,
  clientActions,
  onAnswered,
}: {
  token: string;
  group: HeroGroup;
  clientActions: readonly string[];
  onAnswered: (answer: HeroConfirmedState) => void;
}) {
  const tHero = useTranslations('delivery.hero');
  const tGroup = useTranslations(`delivery.hero.${group}`);
  const tActions = useTranslations('delivery.actions');
  const router = useRouter();
  const hintId = useId();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState<HeroButton | null>(null);
  const [error, setError] = useState<HeroError | null>(null);
  const buttons = GROUP_BUTTONS[group].filter((button) => clientActions.includes(button.verb));
  const noteBlank = note.trim() === '';
  const offersChanges = buttons.some((button) => !button.confirms);

  async function answerOf(verb: string, outcome: HeroOutcome): Promise<HeroAnswer> {
    if (isConceptVerb(verb)) {
      return answerOfConceptOutcome(await respondToDeliveryConcept(token, verb, note));
    }
    return answerOfSignal(await recordDeliveryAction(token, verb, note), outcome);
  }

  function submit(button: HeroButton) {
    setError(null);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const answer = await answerOf(button.verb, button.outcome);
        if ('confirmed' in answer) return onAnswered(answer.confirmed);
        setError(answer.error);
        if (answer.refresh) router.refresh();
      } catch {
        setError('generic');
      } finally {
        setAsking(null);
      }
    });
  }

  return (
    <section className="space-y-3 rounded-panel border-2 border-primary/25 bg-background p-5 shadow-md">
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-primary/10 px-2.5 py-1 text-caption font-bold text-primary ltr:uppercase ltr:tracking-wide">
        <span aria-hidden>●</span>
        {tHero('readyTag')}
      </span>
      <h2 className="text-heading font-semibold">{tGroup('headline')}</h2>
      <p className="text-body text-muted-foreground">{tGroup('body')}</p>
      <ChangesNote note={note} onChange={setNote} hintId={hintId} showHint={offersChanges && noteBlank} />
      <div className="flex flex-col gap-2">
        {buttons.map((button) => (
          <Button
            key={button.verb}
            variant={button.variant}
            className="min-h-11"
            disabled={pending || (!button.confirms && noteBlank)}
            aria-describedby={!button.confirms && noteBlank ? hintId : undefined}
            onClick={() => (button.confirms ? setAsking(button) : submit(button))}
          >
            {pending && !asking && !button.confirms && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {tGroup(button.labelKey)}
          </Button>
        ))}
      </div>
      {error && <HeroErrorText error={error} />}
      <ConfirmActDialog
        open={asking !== null}
        title={tGroup('confirmTitle')}
        body={<p>{tGroup('confirmBody')}</p>}
        confirmLabel={tActions('confirm')}
        cancelLabel={tActions('cancel')}
        pending={pending}
        onConfirm={() => asking && submit(asking)}
        onOpenChange={(open) => !open && setAsking(null)}
      />
    </section>
  );
}
