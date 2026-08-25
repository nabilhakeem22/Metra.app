'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/actions/result';
import { logPaymentAndAdvance } from '@/lib/engagements/actions';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards';
import { isTerminal, type DesignState } from '@/lib/engagements/states';
import { triggerNeedsForm } from '@/lib/engagements/ui';
import { formatMoneyExact } from '@/lib/format/money';
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
        <div className="mb-3.5 flex flex-wrap gap-2">
          {stallDays !== null && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--warn-tint)] px-2.5 py-1 text-xs font-semibold text-[color:var(--warn)]">
              <span aria-hidden>⏱</span>
              {t(`state.${state}`)}
              <span className="font-mono font-medium tabular-nums" dir="ltr">
                · {th('day', { n: stallDays })}
              </span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--track)] px-2.5 py-1 text-xs font-semibold text-[color:var(--text-muted)]">
            <span className="font-mono font-medium tabular-nums" dir="ltr">
              {th('revision', { n: revisionCount, free: freeRevisionN })}
            </span>
          </span>
        </div>
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
            <ul className="mb-5 grid gap-3">
              {items.map((item) => (
                <li key={item.guard} className="flex items-center gap-3 text-sm">
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-md text-xs ${
                      item.ok
                        ? 'bg-[color:var(--success)] text-white'
                        : 'border-2 border-[color:var(--rule)]'
                    }`}
                    aria-hidden
                  >
                    {item.ok ? '✓' : ''}
                  </span>
                  <span className={item.ok ? '' : 'font-semibold'}>
                    {tg(item.guard)}
                  </span>
                  {item.amountDue && (
                    <span
                      className="ms-auto font-mono text-[12.5px] tabular-nums text-[color:var(--warn)]"
                      dir="ltr"
                    >
                      {/* Exact shortfall (told = charged): the badge must show the
                          SAME figure the form pre-fills and recordPaymentCore
                          charges — a 2dp round could overstate it by ~0.005 EGP. */}
                      {th('due', {
                        amount: formatMoneyExact(item.amountDue, locale),
                      })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
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

function PaymentForm({
  engagementId,
  paymentKind,
  defaultAmount,
  advanceTrigger,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  paymentKind: NonNullable<(typeof MONEY_GUARD_MILESTONE)[keyof typeof MONEY_GUARD_MILESTONE]>;
  defaultAmount: string;
  advanceTrigger: EngagementGatePreview['primaryTrigger'];
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onDone: () => void;
}) {
  const th = useTranslations('engagements.hero');
  const tc = useTranslations('engagements.controls');
  const [amount, setAmount] = useState(defaultAmount);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  // One idempotency key per mounted form. The `key={paymentItem.amountDue}`
  // remount (a short-payment revalidation) mints a FRESH key for the genuinely
  // new payment, while a double-click within one open reuses this one — so a
  // blind re-click records the same payment once, not twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  function submit() {
    if (!advanceTrigger) return;
    runAction(async () => {
      const res = await logPaymentAndAdvance(engagementId, {
        paymentKind,
        amount: amount.trim(),
        method: method.trim() || null,
        reference: reference.trim() || null,
        advanceTrigger,
        idempotencyKey,
      });
      if (res.ok) onDone();
      return res;
    });
  }

  return (
    <div className="mt-4 space-y-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="hero-pay-amount">{tc('amount')}</Label>
          <Input
            id="hero-pay-amount"
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hero-pay-method">{tc('method')}</Label>
          <Input
            id="hero-pay-method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hero-pay-reference">{tc('reference')}</Label>
          <Input
            id="hero-pay-reference"
            dir="ltr"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={pending}>
          {tc('cancel')}
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {th('logPaymentAdvance')}
        </Button>
      </div>
    </div>
  );
}
