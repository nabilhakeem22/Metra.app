'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { pickPortalLabel, type PortalLabel } from '@/lib/engagements/portal-labels';
import type { HeroView } from '@/lib/engagements/portal-hero';
import { bidiIsolate } from '@/lib/format/bidi';
import { ConceptOptionPicker } from './concept-option-picker';
import { ActionHero } from './hero-action';

/** The fewest released options that make a choice (one option is no choice). */
const PICKER_MIN_OPTIONS = 2;

/**
 * The hero: the single "what needs you now" surface. At the concept review, with
 * at least two released options and the approval still open, it is the option
 * picker; in any other actionable state it is the group's CTA (./hero-action.tsx);
 * otherwise a calm in-progress / delivered / closed card reusing the client-safe
 * stage label and note, which also repeats the option the client chose, in the
 * letter saved with that choice. Never renders a raw state name.
 */
export function HeroCard({
  token,
  hero,
  stageLabel,
  stageNote,
  clientActions,
  conceptOptions,
  conceptChoice,
}: {
  token: string;
  hero: HeroView;
  stageLabel: PortalLabel;
  stageNote: PortalLabel;
  clientActions: PublicDelivery['clientActions'];
  conceptOptions: PublicDelivery['conceptOptions'];
  conceptChoice: PublicDelivery['conceptChoice'];
}) {
  if (hero.kind === 'action' && hero.group) {
    const picksAnOption =
      hero.group === 'concept' &&
      clientActions.includes('approve_concept') &&
      conceptOptions.length >= PICKER_MIN_OPTIONS;
    if (picksAnOption) return <ConceptOptionPicker token={token} options={conceptOptions} />;
    return <ActionHero token={token} group={hero.group} />;
  }
  return (
    <CalmHero
      kind={hero.kind}
      stageLabel={stageLabel}
      stageNote={stageNote}
      chosenLetter={conceptChoice?.letter ?? null}
    />
  );
}

/** The calm, non-actionable hero (in-progress / delivered / closed). */
function CalmHero({
  kind,
  stageLabel,
  stageNote,
  chosenLetter,
}: {
  kind: HeroView['kind'];
  stageLabel: PortalLabel;
  stageNote: PortalLabel;
  /** The letter saved with the client's concept choice, if they made one. */
  chosenLetter: string | null;
}) {
  const t = useTranslations('delivery.hero');
  const tPicker = useTranslations('delivery.conceptPicker');
  const locale = useLocale();
  const delivered = kind === 'delivered';
  const headline = pickPortalLabel(stageLabel, locale);
  // In-progress reassures ("nothing to do"); delivered/closed keep the stage note.
  const body =
    kind === 'inProgress'
      ? t('reassurance')
      : pickPortalLabel(stageNote, locale);

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
