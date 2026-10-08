'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/textarea';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { chooseDeliveryConcept, respondToDeliveryConcept } from '../actions';
import {
  answerOfConceptOutcome,
  type HeroAnswer,
  type HeroConfirmedState,
  type HeroError,
} from './hero-answer';
import { ConceptOptionCard } from './concept-option-card';
import { HeroConfirmed } from './hero-confirmed';

type ConceptOption = PublicDelivery['conceptOptions'][number];

/**
 * The concept review as a CHOICE (Round B, B12): one card per released option,
 * lettered A to D by the database, each with "View" (new tab) and "Choose this
 * option", which asks first (Cancel calls nothing). The letter the client saw is
 * sent and saved; the answer names only a SAVED decision (a repeat shows the one
 * on file), and changed options or a closed review refresh the page with a
 * message (./hero-answer.ts). "Request changes" stays while it is offered.
 */
export function ConceptOptionPicker({
  token,
  options,
  canRequestChanges,
}: {
  token: string;
  options: ConceptOption[];
  /** `request_concept_changes` is among the client actions on offer. */
  canRequestChanges: boolean;
}) {
  const t = useTranslations('delivery.conceptPicker');
  const tHero = useTranslations('delivery.hero');
  const tGroup = useTranslations('delivery.hero.concept');
  const tActions = useTranslations('delivery.actions');
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState<HeroConfirmedState | null>(null);
  const [error, setError] = useState<HeroError | null>(null);

  function run(act: () => Promise<HeroAnswer>) {
    setError(null);
    startTransition(async () => {
      try {
        const answer = await act();
        if ('confirmed' in answer) return setConfirmed(answer.confirmed);
        setError(answer.error);
        if (answer.refresh) router.refresh();
      } catch {
        setError('generic');
      }
    });
  }

  async function choose(option: ConceptOption) {
    const letter = bidiIsolate(option.letter);
    const accepted = await confirm({
      title: t('confirmTitle', { letter }),
      description: t('confirmBody'),
      confirmLabel: t('confirm', { letter }),
      cancelLabel: t('cancel'),
    });
    if (!accepted) return;
    run(async () => answerOfConceptOutcome(await chooseDeliveryConcept(token, option.id, option.position, note)));
  }

  if (confirmed) {
    return (
      <HeroConfirmed
        group="concept"
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
      <h2 className="text-heading font-semibold">{t('title')}</h2>
      <p className="text-body text-muted-foreground">{t('body')}</p>
      <ul className="space-y-2">
        {options.map((option) => (
          <ConceptOptionCard
            key={option.id}
            token={token}
            option={option}
            pending={pending}
            onChoose={() => void choose(option)}
          />
        ))}
      </ul>
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        rows={2}
        dir="auto"
        placeholder={tActions('notePlaceholder')}
      />
      {canRequestChanges && (
        <Button
          variant="ghost"
          className="w-full"
          disabled={pending}
          onClick={() =>
            run(async () =>
              answerOfConceptOutcome(await respondToDeliveryConcept(token, 'request_concept_changes', note)),
            )
          }
        >
          {tGroup('changes')}
        </Button>
      )}
      {error && (
        <p className="text-body text-destructive" role="alert">
          {error === 'changed' || error === 'movedOn' ? t(error) : tActions(`error.${error}`)}
        </p>
      )}
      {dialog}
    </section>
  );
}
