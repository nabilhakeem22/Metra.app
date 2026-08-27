'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards';
import { isTerminal, type DesignState } from '@/lib/engagements/states';
import { triggerNeedsForm } from '@/lib/engagements/ui';
import { EngagementHeroBadges } from './engagement-hero-badges';
import { EngagementHeroChecklist } from './engagement-hero-checklist';
import { PaymentForm } from './engagement-payment-form';
import { DIRECT_TRIGGER_ACTIONS } from './trigger-actions';

// The cockpit hero — the single "what's next" panel at the top of the main column
// (below the phase rail). It renders a MACHINE-TRUTHFUL guard checklist from the
// server gate preview, the stall + revision badges, and ONE combined primary CTA:
// a blocking payment gate opens the pay-and-advance form (amount pre-filled to the
// shortfall); an all-clear gate advances directly. Reskinned to the glass system:
// this is the ONE cockpit-body surface that carries the `.glass` blur recipe (the
// primary focal), tinted with a brand hairline; every other cockpit panel stays
// flat so the route's blur budget holds (Hero + 3 existing glass Cards = 4, +2
// shell = 6). Logical CSS only so it mirrors correctly in ar-EG RTL; money is
// `tabular-nums`, `dir=ltr`.

export function EngagementHero({
  engagementId,
  preview,
  state,
  revisionCount,
  freeRevisionN,
  stallDays,
  canAdvance,
  canRecordPayment,
  pending,
  runAction,
  onRecordSomethingElse,
}: {
  engagementId: string;
  preview: EngagementGatePreview;
  state: DesignState;
  revisionCount: number;
  freeRevisionN: number;
  stallDays: number | null;
  canAdvance: boolean;
  canRecordPayment: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onRecordSomethingElse: () => void;
}) {
  const t = useTranslations('engagements');
  const th = useTranslations('engagements.hero');
  const tg = useTranslations('engagements.guard');
  const locale = useLocale();
  const [payOpen, setPayOpen] = useState(false);

  const closed = isTerminal(state);
  const headline = closed ? th('closed.headline') : th(`${state}.headline`);
  const hint = closed ? th('closed.hint') : th(`${state}.hint`);

  const { primaryTrigger, items, allClear } = preview;

  // A blocking money gate whose shortfall we can pre-fill — the pay-and-advance
  // path. `amountDue` is only set on a blocking payment gate (see gate-preview).
  const paymentItem = items.find(
    (item) => !item.ok && MONEY_GUARD_MILESTONE[item.guard] && item.amountDue,
  );
  const paymentKind = paymentItem
    ? MONEY_GUARD_MILESTONE[paymentItem.guard]
    : undefined;

  const needsForm = primaryTrigger ? triggerNeedsForm(primaryTrigger) : false;
  const directAction = primaryTrigger
    ? DIRECT_TRIGGER_ACTIONS[primaryTrigger]
    : undefined;

  const showPayCta = Boolean(
    primaryTrigger && paymentItem && paymentKind && canRecordPayment && canAdvance,
  );
  const showDirectCta = Boolean(
    primaryTrigger && allClear && canAdvance && !needsForm && directAction,
  );

  function fireDirect() {
    if (directAction) runAction(() => directAction(engagementId));
  }

  return (
    <section className="glass border-[color:var(--brand-tint-border)] p-5 text-[color:var(--text)] sm:p-6">
      {!closed && (
        <EngagementHeroBadges
          t={t}
          th={th}
          state={state}
          stallDays={stallDays}
          revisionCount={revisionCount}
          freeRevisionN={freeRevisionN}
        />
      )}

      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-brand-ink">
        {th('whatsNext')}
      </p>
      <h2 className="mb-1 text-[22px] font-semibold leading-tight text-balance">
        {headline}
      </h2>
      <p className="mb-4 text-[13.5px] text-[color:var(--text-muted)]">{hint}</p>

      {primaryTrigger && !closed && (
        <>
          {items.length > 0 && (
            <EngagementHeroChecklist th={th} tg={tg} locale={locale} items={items} />
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {showPayCta && (
              <Button
                type="button"
                disabled={pending}
                onClick={() => setPayOpen((open) => !open)}
              >
                {th('logPaymentAdvance')}
              </Button>
            )}
            {showDirectCta && (
              <Button
                type="button"
                disabled={pending}
                onClick={fireDirect}
              >
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                {th('advance')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onRecordSomethingElse}
            >
              {th('recordSomethingElse')}
            </Button>
          </div>

          {showPayCta && (
            <p className="mt-3.5 flex items-baseline gap-1.5 text-[12.5px] text-[color:var(--text-muted)]">
              <span aria-hidden>◆</span>
              <span>{th('payNote')}</span>
            </p>
          )}

          {showPayCta && payOpen && paymentKind && paymentItem?.amountDue && primaryTrigger && (
            // key = the current shortfall: when a SHORT payment persists and the
            // server checklist revalidates to a reduced due, this key changes and
            // React REMOUNTS the form — re-deriving the pre-filled amount from the
            // new (smaller) due, so a blind re-click can't re-charge the old figure
            // against the append-only ledger (S1: over-collection on re-click).
            <PaymentForm
              key={paymentItem.amountDue}
              engagementId={engagementId}
              paymentKind={paymentKind}
              defaultAmount={paymentItem.amountDue}
              advanceTrigger={primaryTrigger}
              pending={pending}
              runAction={runAction}
              onDone={() => setPayOpen(false)}
            />
          )}
        </>
      )}
    </section>
  );
}
