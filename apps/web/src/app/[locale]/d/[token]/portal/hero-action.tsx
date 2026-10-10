'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { isBlankNote } from '@/lib/engagements/client-note';
import { lockedWorkCount, workImages } from '@/lib/engagements/portal-gallery';
import type { HeroGroup } from '@/lib/engagements/portal-hero';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { reviewSeenOf } from '@/lib/engagements/review-seen';
import { ChangesNote } from './changes-note';
import { ConfirmActDialog } from './confirm-act-dialog';
import type { HeroConfirmedState, HeroError } from './hero-answer';
import { GROUP_BUTTONS, type HeroButton } from './hero-buttons';
import { HeroConfirmBody } from './hero-confirm-body';
import { HeroErrorText } from './hero-error';
import { sendHeroVerb } from './hero-verbs';
import { HeroWorkStrip } from './hero-work-strip';

/** What the action hero reads off the delivery. */
export type ActionHeroReview = Pick<PublicDelivery, 'clientActions' | 'documents' | 'rom' | 'timeline'>;

/**
 * The actionable hero, top to bottom (fix round F3, so the one filled button
 * sits on the first screen): the plain-language CTA, its primary act (Approve,
 * Confirm handover), the WORK to look at (./hero-work-strip.tsx), then the
 * note and "Request changes", which needs the note. One primary, never a menu.
 * Approving and confirming the handover ask first (ConfirmActDialog, repeating
 * the first picture; Cancel sends nothing). The final approval, when the
 * budget range is also waiting, acknowledges it in the SAME confirmation. Every
 * act carries what this hero SHOWED (the render round, the band; F1/F2), and
 * answers from the decision SAVED on file. A confirmed answer goes UP
 * (`onAnswered`): the command card keeps it on screen across the refresh.
 */
export function ActionHero({
  token,
  group,
  review,
  onAnswered,
}: {
  token: string;
  group: HeroGroup;
  review: ActionHeroReview;
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
  const { clientActions, rom } = review;
  const buttons = GROUP_BUTTONS[group].filter((button) => clientActions.includes(button.verb));
  const noteBlank = isBlankNote(note);
  const offersChanges = buttons.some((button) => !button.confirms);
  const work = workImages(review.documents, group);
  const budget = group === 'design' && clientActions.includes('acknowledge_rom') && rom && (rom.low || rom.high) ? rom : null;
  const seen = reviewSeenOf(review);

  function submit(button: HeroButton) {
    setError(null);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const answer = await sendHeroVerb(token, button.verb, note, { withBudget: budget !== null, seen });
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

  const buttonOf = (button: HeroButton) => (
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
  );

  return (
    <section className="space-y-3 rounded-panel border-2 border-primary/25 bg-background p-5 shadow-md">
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-primary/10 px-2.5 py-1 text-caption font-bold text-primary ltr:uppercase ltr:tracking-wide">
        <span aria-hidden>●</span>
        {tHero('readyTag')}
      </span>
      <h2 className="text-heading font-semibold">{tGroup('headline')}</h2>
      <p className="text-body text-muted-foreground">{tGroup('body')}</p>
      <div className="flex flex-col gap-2">{buttons.filter((button) => button.confirms).map(buttonOf)}</div>
      {group !== 'handoff' && (
        <HeroWorkStrip token={token} images={work} lockedCount={lockedWorkCount(review.documents, group)} />
      )}
      <ChangesNote note={note} onChange={setNote} hintId={hintId} showHint={offersChanges && noteBlank} />
      {offersChanges && <div className="flex flex-col gap-2">{buttons.filter((button) => !button.confirms).map(buttonOf)}</div>}
      {error && <HeroErrorText error={error} />}
      <ConfirmActDialog
        open={asking !== null}
        title={tGroup('confirmTitle')}
        body={<HeroConfirmBody token={token} group={group} firstImage={work[0] ?? null} budget={budget} />}
        confirmLabel={tActions('confirm')}
        cancelLabel={tActions('cancel')}
        pending={pending}
        onConfirm={() => asking && submit(asking)}
        onOpenChange={(open) => !open && setAsking(null)}
      />
    </section>
  );
}
