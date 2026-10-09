'use client';

import { useTranslations } from 'next-intl';
import type { HeroView } from '@/lib/engagements/portal-hero';
import type { PortalStageKey } from '@/lib/engagements/portal-stage';
import { bidiIsolate } from '@/lib/format/bidi';

/**
 * The calm, non-actionable hero (in progress / delivered / closed): the stage's
 * label and note from the catalog (`delivery.stage.<key>`), and the option the
 * client chose, in the letter saved with that choice. Never a raw state name.
 */
export function CalmHero({
  kind,
  stageKey,
  chosenLetter,
}: {
  kind: HeroView['kind'];
  stageKey: PortalStageKey;
  /** The letter saved with the client's concept choice, if they made one. */
  chosenLetter: string | null;
}) {
  const t = useTranslations('delivery.hero');
  const tStage = useTranslations('delivery.stage');
  const tPicker = useTranslations('delivery.conceptPicker');
  const delivered = kind === 'delivered';
  // In-progress reassures ("nothing to do"); delivered/closed keep the stage note.
  const body = kind === 'inProgress' ? t('reassurance') : tStage(`${stageKey}.note`);

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
      <h2 className="text-heading font-semibold">{tStage(`${stageKey}.label`)}</h2>
      <p className="text-body text-muted-foreground">{body}</p>
      {chosenLetter && kind !== 'closed' && (
        <p className="text-body font-medium">
          {tPicker('chosen', { letter: bidiIsolate(chosenLetter) })}
        </p>
      )}
    </section>
  );
}
