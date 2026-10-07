'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  pickPortalLabel,
  type PortalLabel,
} from '@/lib/engagements/portal-labels';
import type { HeroGroup, HeroView } from '@/lib/engagements/portal-hero';
import { recordDeliveryAction } from '../actions';
import { Textarea } from '@/components/ui/textarea';
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
 * The hero: the single "what needs you now" surface. In an actionable state it
 * carries the plain-language CTA + a note field and fires the existing
 * `recordDeliveryAction`; otherwise it is a calm in-progress / delivered / closed
 * card reusing the client-safe stage label + note. Never renders a raw state name.
 */
export function HeroCard({
  token,
  hero,
  stageLabel,
  stageNote,
}: {
  token: string;
  hero: HeroView;
  stageLabel: PortalLabel;
  stageNote: PortalLabel;
}) {
  if (hero.kind === 'action' && hero.group) {
    return <ActionHero token={token} group={hero.group} />;
  }
  return <CalmHero kind={hero.kind} stageLabel={stageLabel} stageNote={stageNote} />;
}

function ActionHero({ token, group }: { token: string; group: HeroGroup }) {
  const tHero = useTranslations('delivery.hero');
  const tGroup = useTranslations(`delivery.hero.${group}`);
  const tActions = useTranslations('delivery.actions');
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState<{
    outcome: HeroOutcome;
    studioNotified: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttons = GROUP_BUTTONS[group];

  function submit(verb: string, outcome: HeroOutcome) {
    setError(null);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const result = await recordDeliveryAction(token, verb, note);
        // `already` resolves ok:true (idempotent) — treat as a confirmed signal.
        if (result.ok) setConfirmed({ outcome, studioNotified: result.studioNotified === true });
        else setError(result.error ?? 'generic');
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
          {tActions(`error.${error}`)}
        </p>
      )}
    </section>
  );
}

/** The calm, non-actionable hero (in-progress / delivered / closed). */
function CalmHero({
  kind,
  stageLabel,
  stageNote,
}: {
  kind: HeroView['kind'];
  stageLabel: PortalLabel;
  stageNote: PortalLabel;
}) {
  const t = useTranslations('delivery.hero');
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
    </section>
  );
}
