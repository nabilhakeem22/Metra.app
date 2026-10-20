'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { PendingClaimRow } from '@/lib/execution/claims/queries';
import { formatDate } from '@/lib/format/date';

/**
 * The client's "I paid" claims that wait for the studio (B4.2), above the
 * requests on the Payments tab: which request, what was still due when the
 * client sent it, and when. The roles that record payments confirm it (the
 * money arrived: a payment is recorded) or answer "not received" (no payment).
 * The buttons only ask the tab to open the act: its dialog lives on the tab, so
 * a read of the tab never unmounts it. Nothing renders while no claim waits.
 */
export function ClaimsPanel({
  claims,
  canAnswer,
  m,
  onConfirm,
  onDismiss,
}: {
  claims: PendingClaimRow[];
  /** `payments` create and update: owner, admin, accountant. */
  canAnswer: boolean;
  m: (value: string) => string;
  onConfirm: (claim: PendingClaimRow) => void;
  onDismiss: (claim: PendingClaimRow) => void;
}) {
  const t = useTranslations('contracts.execution.payments.claims');
  const locale = useLocale();
  if (claims.length === 0) return null;

  return (
    <section className="space-y-2 rounded-item border border-[color:var(--warn)] p-3" aria-labelledby="claims-panel-title">
      <h3 id="claims-panel-title" className="text-body font-semibold">
        {t('title')}
      </h3>
      <ul>
        {claims.map((claim) => (
          <li key={claim.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 first:border-t-0" data-claim-id={claim.id}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span dir="ltr" className="font-mono tabular-nums">{claim.requestNumber}</span>
                <span dir="ltr" className="font-mono tabular-nums">{m(claim.claimedAmount)}</span>
              </div>
              <div className="text-caption text-muted-foreground">{t('claimedOn', { date: formatDate(claim.claimedAt, locale) })}</div>
            </div>
            {canAnswer && (
              <div className="flex flex-wrap gap-1">
                <Button variant="secondary" size="sm" onClick={() => onConfirm(claim)}>
                  {t('confirm.open')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDismiss(claim)}>
                  {t('dismiss.open')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
