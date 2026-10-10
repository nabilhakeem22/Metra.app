'use client';

import { Check, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { PublicDelivery } from '@/lib/engagements/public';
import type { PortalErrorKey } from '@/lib/engagements/portal-error-key';
import { bandSeenOf } from '@/lib/engagements/review-seen';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { acknowledgeDeliveryBudget } from '../review-actions';
import { BudgetRange } from './budget-range';

/**
 * The budget card: the issued range, ALWAYS, whenever the studio has issued one
 * (the caller renders it only then), before and after the client has seen it.
 * The acknowledge button shows only while the server offers it (`canAcknowledge`
 * = the hero's `showRomAck`); it fires the append-only advisory
 * `acknowledgeDeliveryBudget` with the band THIS card shows (another band issued
 * meanwhile writes nothing and the page re-reads, F1), a repeat answering from
 * the acknowledgement on file (F7), and then re-reads the page. The button is
 * the page's filled one only while the hero asks for nothing (F10). Once acknowledged the range stays with "You saw this range on
 * {date}" (the day on file, Round C), or "You have seen this range" until the
 * page re-reads it, and says the team was notified only when it really was.
 * Theme tokens only, so the confirmed state reads in light and dark.
 */
export function BudgetCard({
  token,
  rom,
  canAcknowledge,
  acknowledgedAt,
  prominent,
}: {
  token: string;
  rom: NonNullable<PublicDelivery['rom']>;
  canAcknowledge: boolean;
  /** When the client acknowledged THIS range (the current issuance), or null. */
  acknowledgedAt: PublicDelivery['romAcknowledgedAt'];
  /** The page's one filled button? Not while the hero asks for something (F10). */
  prominent: boolean;
}) {
  const t = useTranslations('delivery.budget');
  const tActions = useTranslations('delivery.actions');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Non-null once acknowledged; says whether the studio was really notified.
  const [confirmed, setConfirmed] = useState<{ studioNotified: boolean } | null>(null);
  const [error, setError] = useState<PortalErrorKey | 'changed' | null>(null);

  function acknowledge() {
    setError(null);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        // The band this card shows: another band issued meanwhile writes nothing (F1).
        const outcome = await acknowledgeDeliveryBudget(token, bandSeenOf({ rom }));
        if (outcome.kind === 'changed') {
          setError('changed');
          return router.refresh();
        }
        if (outcome.kind === 'error') return setError(outcome.error);
        setConfirmed({ studioNotified: outcome.studioNotified });
        router.refresh();
      } catch {
        setError('generic');
      }
    });
  }

  return (
    <section className="space-y-3 rounded-panel border bg-background p-4 shadow-sm">
      <div>
        <h2 className="text-body font-semibold">{t('title')}</h2>
        <p className="text-caption text-muted-foreground">{t('preparedBy')}</p>
      </div>
      <BudgetRange rom={rom} />
      {confirmed || acknowledgedAt ? (
        <div
          role="status"
          className="space-y-0.5 rounded-item bg-[color:var(--success-tint)] px-3 py-2.5 text-[color:var(--success)]"
        >
          <p className="flex items-center gap-2 text-body font-semibold">
            <Check className="size-4 shrink-0" aria-hidden />
            {acknowledgedAt
              ? t('acknowledgedOn', { date: bidiIsolate(formatDate(acknowledgedAt, locale)) })
              : t('acknowledgedNote')}
          </p>
          {confirmed && (
            <p className="text-caption">
              {confirmed.studioNotified ? t('acknowledgedNotified') : t('acknowledged')}
            </p>
          )}
        </div>
      ) : (
        <p className="text-caption text-muted-foreground">{t('note')}</p>
      )}
      {canAcknowledge && !confirmed && (
        <>
          <Button variant={prominent ? 'default' : 'secondary'} className="min-h-11 w-full" disabled={pending} onClick={acknowledge}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('acknowledge')}
          </Button>
          {error && (
            <p className="text-body text-destructive" role="alert">
              {error === 'changed' ? tActions('changed') : tActions(`error.${error}`)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
