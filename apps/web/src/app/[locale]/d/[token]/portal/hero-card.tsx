'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  pickPortalLabel,
  type PortalLabel,
} from '@/lib/engagements/portal-labels';
import type { HeroGroup, HeroView } from '@/lib/engagements/portal-hero';
import { recordDeliveryAction } from '../actions';

/** The confirmation an acted-on button resolves to (names the next phase). */
type HeroOutcome = 'approved' | 'changes' | 'acknowledged';

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

/** Which `delivery.hero.<group>` title/body keys each outcome confirms with. */
const CONFIRM_KEYS: Record<HeroOutcome, { title: string; body: string }> = {
  approved: { title: 'approvedTitle', body: 'approvedBody' },
  changes: { title: 'changesTitle', body: 'changesBody' },
  acknowledged: { title: 'acknowledgedTitle', body: 'acknowledgedBody' },
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
  const [confirmed, setConfirmed] = useState<HeroOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttons = GROUP_BUTTONS[group];

  function submit(verb: string, outcome: HeroOutcome) {
    setError(null);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const result = await recordDeliveryAction(token, verb, note);
        // `already` resolves ok:true (idempotent) — treat as a confirmed signal.
        if (result.ok) setConfirmed(outcome);
        else setError(result.error ?? 'generic');
      } catch {
        setError('generic');
      }
    });
  }

  if (confirmed) {
    const keys = CONFIRM_KEYS[confirmed];
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center shadow-sm">
        <CheckCircle2
          className="mx-auto mb-3 size-11 text-emerald-600"
          aria-hidden
        />
        <h2 className="text-lg font-semibold text-emerald-900">
          {tGroup(keys.title)}
        </h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-emerald-800">
          {tGroup(keys.body)}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border-2 border-primary/25 bg-background p-5 shadow-md">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-primary">
        <span aria-hidden>●</span>
        {tHero('readyTag')}
      </span>
      <h2 className="text-xl font-semibold tracking-tight">{tGroup('headline')}</h2>
      <p className="text-sm text-muted-foreground">{tGroup('body')}</p>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        rows={2}
        placeholder={tActions('notePlaceholder')}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
        <p className="text-sm text-destructive" role="alert">
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
      className={`space-y-2 rounded-2xl border bg-background p-5 shadow-sm ${
        delivered ? 'border-emerald-200' : ''
      }`}
    >
      {kind !== 'closed' && (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
            delivered
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {delivered ? t('deliveredTag') : t('inProgressTag')}
        </span>
      )}
      <h2 className="text-xl font-semibold tracking-tight">{headline}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </section>
  );
}
