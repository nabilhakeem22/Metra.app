'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatPortalMoney } from './portal-money';

/**
 * The highlighted NEXT payment: which milestone, what remains on it, and the
 * prominent "I've made this payment" control (or its waiting note). The amount is
 * the server-locked remaining when the milestone is claimable, so the figure the
 * client reads is the figure a claim records.
 */
export function NextPayment({
  label,
  amountRemaining,
  claimControl,
}: {
  label: string;
  amountRemaining: string;
  claimControl: ReactNode;
}) {
  const t = useTranslations('delivery.payments');
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-2.5 rounded-item bg-[color:var(--warn-tint)] p-3">
      <p className="text-body font-bold text-[color:var(--warn)]">
        {t('nextPayment', { milestone: label })}
      </p>
      <p className="text-heading font-bold tabular-nums text-foreground">
        <bdi>{formatPortalMoney(amountRemaining, locale)}</bdi>
      </p>
      {claimControl}
    </div>
  );
}
