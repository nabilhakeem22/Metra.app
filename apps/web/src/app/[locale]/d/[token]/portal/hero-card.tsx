'use client';

import { useTranslations } from 'next-intl';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import type { HeroView } from '@/lib/engagements/portal-hero';
import type { PortalStageKey } from '@/lib/engagements/portal-stage';
import { bidiIsolate } from '@/lib/format/bidi';
import { ConceptOptionPicker } from './concept-option-picker';
import { ActionHero } from './hero-action';

/** The fewest released options that make a choice (one option is no choice). */
const PICKER_MIN_OPTIONS = 2;

/**
 * The hero: the single "what needs you now" surface. At the concept review, with
 * at least two released options and the approval still open, it is the option
 * picker; in any other actionable state it is the group's CTA (./hero-action.tsx);
 * otherwise a calm in-progress / delivered / closed card with the stage's label
 * and note from the catalog (`delivery.stage.<key>`), which also repeats the
 * option the client chose, in the letter saved with that choice. Never renders
 * a raw state name.
 */
export function HeroCard({
  token,
  hero,
  stageKey,
  clientActions,
  conceptOptions,
  conceptChoice,
}: {
  token: string;
  hero: HeroView;
  stageKey: PortalStageKey;
  clientActions: PublicDelivery['clientActions'];
  conceptOptions: PublicDelivery['conceptOptions'];
  conceptChoice: PublicDelivery['conceptChoice'];
}) {
  if (hero.kind === 'action' && hero.group) {
    const picksAnOption =
      hero.group === 'concept' &&
      clientActions.includes('approve_concept') &&
      conceptOptions.length >= PICKER_MIN_OPTIONS;
    if (picksAnOption) {
      return (
        <ConceptOptionPicker
          token={token}
          options={conceptOptions}
          canRequestChanges={clientActions.includes('request_concept_changes')}
        />
      );
    }
    return <ActionHero token={token} group={hero.group} clientActions={clientActions} />;
  }
  return (
    <CalmHero
      kind={hero.kind}
      stageKey={stageKey}
      chosenLetter={conceptChoice?.letter ?? null}
    />
  );
}

/** The calm, non-actionable hero (in-progress / delivered / closed). */
function CalmHero({
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
  const headline = tStage(`${stageKey}.label`);
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
      <h2 className="text-heading font-semibold">{headline}</h2>
      <p className="text-body text-muted-foreground">{body}</p>
      {chosenLetter && kind !== 'closed' && (
        <p className="text-body font-medium">
          {tPicker('chosen', { letter: bidiIsolate(chosenLetter) })}
        </p>
      )}
    </section>
  );
}
