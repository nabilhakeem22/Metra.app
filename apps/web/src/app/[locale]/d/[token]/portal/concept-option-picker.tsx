'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { UNCONFIRMED_WRITE } from '@/lib/share/portal-failure';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { chooseDeliveryConcept, respondToDeliveryConcept } from '../review-actions';
import {
  answerOfConceptOutcome,
  type HeroAnswer,
  type HeroConfirmedState,
  type HeroFailure,
} from './hero-answer';
import { ChangesNote } from './changes-note';
import { ConceptOptionCard } from './concept-option-card';
import { HeroErrorText } from './hero-error';
import { useChangesNote } from './use-changes-note';

type ConceptOption = PublicDelivery['conceptOptions'][number];

/**
 * The concept review as a CHOICE (Round B, B12): one card per released option,
 * lettered A to D by the database, each with "View" (new tab) and "Choose this
 * option", which asks first (Cancel calls nothing). The letter the client saw is
 * sent and saved; the answer names only a SAVED decision (a repeat shows the one
 * on file), and changed options or a closed review refresh the page with a
 * message (./hero-answer.ts). "Request changes" stays while it is offered, and
 * needs a note. A confirmed answer goes UP (`onAnswered`): the command card keeps
 * it on screen across the refresh that follows.
 */
export function ConceptOptionPicker({
  token,
  options,
  canRequestChanges,
  onAnswered,
}: {
  token: string;
  options: ConceptOption[];
  /** `request_concept_changes` is among the client actions on offer. */
  canRequestChanges: boolean;
  onAnswered: (answer: HeroConfirmedState) => void;
}) {
  const t = useTranslations('delivery.conceptPicker');
  const tHero = useTranslations('delivery.hero');
  const tGroup = useTranslations('delivery.hero.concept');
  const router = useRouter();
  const hintId = useId();
  const noteId = useId();
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const notes = useChangesNote();
  const [failure, setFailure] = useState<HeroFailure | null>(null);
  const noteBlank = notes.noteBlank;

  function run(act: () => Promise<HeroAnswer>) {
    setFailure(null);
    startTransition(async () => {
      try {
        const answer = await act();
        if ('confirmed' in answer) return onAnswered(answer.confirmed);
        const { refresh, ...refusal } = answer;
        setFailure(refusal);
        if (refresh) router.refresh();
      } catch {
        // The answer never came back: it may have been saved (UNCONFIRMED_WRITE).
        setFailure(UNCONFIRMED_WRITE);
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
    run(async () => answerOfConceptOutcome(await chooseDeliveryConcept(token, option.id, option.position, notes.note)));
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
      <ChangesNote id={noteId} state={notes} hintId={hintId} showHint={canRequestChanges && noteBlank} />
      {canRequestChanges && (
        <Button
          variant="ghost"
          className="min-h-11 w-full"
          disabled={pending}
          aria-describedby={noteBlank && !notes.noteError ? hintId : undefined}
          onClick={() =>
            notes.readyForChanges() &&
            run(async () =>
              answerOfConceptOutcome(await respondToDeliveryConcept(token, 'request_concept_changes', notes.note)),
            )
          }
        >
          {tGroup('changes')}
        </Button>
      )}
      {failure && <HeroErrorText failure={failure} />}
      {dialog}
    </section>
  );
}
