'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** The all-paid close: a tick and a thank-you in place of the next payment. */
export function SettledNote() {
  const t = useTranslations('delivery.payments');
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--success-tint)] text-[color:var(--success)]"
        aria-hidden
      >
        <Check className="size-4" />
      </span>
      <div>
        <p className="text-body font-semibold">{t('settledTitle')}</p>
        <p className="text-caption text-muted-foreground">{t('settledBody')}</p>
      </div>
    </div>
  );
}

/** The paid-so-far bar. A plain width: in RTL the bar fills from the right by itself. */
export function PaidMeter({ percentPaid, label }: { percentPaid: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentPaid}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <span
        className="block h-full rounded-full bg-[color:var(--success)]"
        style={{ width: `${percentPaid}%` }}
      />
    </div>
  );
}
