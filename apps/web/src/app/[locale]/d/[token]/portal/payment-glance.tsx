'use client';

import { CreditCard } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PaymentGlance } from '@/lib/engagements/portal-hero';
import { formatMoney } from '@/lib/format/money';

/**
 * The at-a-glance payment line: a "deposit received" chip and the next amount due,
 * or an "all settled" note. DUE amounts only (never cost) — the money is rendered
 * LTR with Western numerals. Renders nothing when there is no schedule signal.
 */
export function PaymentGlanceCard({ glance }: { glance: PaymentGlance }) {
  const t = useTranslations('delivery.glance');
  const locale = useLocale();

  const hasSignal = glance.depositPaid || glance.nextDue !== null || glance.allSettled;
  if (!hasSignal) return null;

  return (
    <section className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-amber-600"
        aria-hidden
      >
        <CreditCard className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          {t('title')}
        </p>
        <p className="mt-0.5 text-sm font-semibold">
          {glance.allSettled ? (
            t('allSettled')
          ) : (
            <span className="flex flex-wrap items-center gap-x-1.5">
              {glance.depositPaid && <span>{t('depositPaid')}</span>}
              {glance.nextDue && (
                <span dir="ltr">
                  {t('next', { amount: formatMoney(glance.nextDue.amount_due, locale) })}
                </span>
              )}
            </span>
          )}
        </p>
      </div>
    </section>
  );
}
