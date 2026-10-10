'use client';

import { CalendarClock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { AnsweredReview } from '@/lib/engagements/portal-answered';
import type { HeroView } from '@/lib/engagements/portal-hero';
import type { PortalStageKey } from '@/lib/engagements/portal-stage';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';

/** The headline and body a calm hero shows once the client answered a review. */
function useAnsweredCopy(answered: AnsweredReview | null): { headline: string; body: string } | null {
  const t = useTranslations('delivery.hero.answered');
  const tPicker = useTranslations('delivery.conceptPicker');
  if (!answered) return null;
  if (answered.kind === 'handoverReceived') return { headline: t('handoverReceived'), body: t('handoverBody') };
  const headline =
    answered.kind === 'conceptChosen'
      ? tPicker('chosen', { letter: bidiIsolate(answered.letter) })
      : t(answered.kind);
  return { headline, body: t('body') };
}

/**
 * The calm, non-actionable hero (in progress / delivered / closed). Normally the
 * stage's label and note from the catalog (`delivery.stage.<key>`). Once the
 * client has ANSWERED the stage's review (./lib/engagements/portal-answered.ts) it
 * says what they did and that the studio is preparing the next step, never the
 * stage's "ready for your approval". Elsewhere it repeats the option the client
 * chose, in the letter saved with that choice. Never a raw state name.
 *
 * Round C: in progress, it says when the studio expects the next step (when the
 * studio set a date that still holds); delivered, it says on which day.
 */
export function CalmHero({
  kind,
  stageKey,
  answered,
  chosenLetter,
  expectedOn,
  deliveredAt,
}: {
  kind: HeroView['kind'];
  stageKey: PortalStageKey;
  answered: AnsweredReview | null;
  /** The letter saved with the client's concept choice, if they made one. */
  chosenLetter: string | null;
  /** The day (YYYY-MM-DD) the studio expects the next step, or null. */
  expectedOn: string | null;
  /** When the design was delivered (the newest delivered stage move), or null. */
  deliveredAt: string | null;
}) {
  const t = useTranslations('delivery.hero');
  const tStage = useTranslations('delivery.stage');
  const tPicker = useTranslations('delivery.conceptPicker');
  const locale = useLocale();
  const answeredCopy = useAnsweredCopy(answered);
  const delivered = kind === 'delivered';
  const date = (instant: string) => bidiIsolate(formatDate(instant, locale));
  const deliveredHeadline = delivered && deliveredAt ? t('deliveredOn', { date: date(deliveredAt) }) : null;
  // In-progress reassures ("nothing to do"); delivered/closed keep the stage note.
  const headline = answeredCopy?.headline ?? deliveredHeadline ?? tStage(`${stageKey}.label`);
  const body = answeredCopy?.body ?? (kind === 'inProgress' ? t('reassurance') : tStage(`${stageKey}.note`));
  // The answered headline of a choice already names the option: say it once.
  const repeatsChoice = chosenLetter && kind !== 'closed' && answered?.kind !== 'conceptChosen';

  return (
    <section
      className={`space-y-2 rounded-panel border bg-background p-5 shadow-sm ${
        delivered ? 'border-[color:var(--success)]/30' : ''
      }`}
    >
      {kind !== 'closed' && (
        <span
          className={`inline-flex items-center rounded-pill px-2.5 py-1 text-caption font-bold ltr:uppercase ltr:tracking-wide ${
            delivered
              ? 'bg-[color:var(--success-tint)] text-[color:var(--success)]'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {delivered ? t('deliveredTag') : t('inProgressTag')}
        </span>
      )}
      <h2 className="text-heading font-semibold">{headline}</h2>
      <p className="text-body text-muted-foreground">{body}</p>
      {kind === 'inProgress' && expectedOn && (
        <p className="flex items-center gap-1.5 text-body font-medium">
          <CalendarClock className="size-4 shrink-0 text-primary" aria-hidden />
          {t('expectedBy', { date: date(expectedOn) })}
        </p>
      )}
      {repeatsChoice && chosenLetter && (
        <p className="text-body font-medium">
          {tPicker('chosen', { letter: bidiIsolate(chosenLetter) })}
        </p>
      )}
    </section>
  );
}
