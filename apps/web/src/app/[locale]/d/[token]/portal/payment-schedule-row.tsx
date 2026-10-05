'use client';

import type { ReactNode } from 'react';
import { Check, Circle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PaymentRow } from '@/lib/engagements/portal-payments';
import { bidiIsolate } from '@/lib/format/bidi';
import { cn } from '@/lib/utils';
import { formatPortalAmount, formatPortalMoney } from './portal-money';

/** The round marker at the row's start: a tick when paid, a dot otherwise. */
function RowMarker({ row }: { row: PaymentRow }) {
  const tone =
    row.state === 'paid'
      ? 'bg-[color:var(--success-tint)] text-[color:var(--success)]'
      : row.isNext
        ? 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={cn('grid size-6 place-items-center rounded-full', tone)} aria-hidden>
      {row.state === 'paid' ? (
        <Check className="size-3.5" />
      ) : (
        <Circle className="size-2 fill-current" />
      )}
    </span>
  );
}

/**
 * One milestone in the schedule: its name, how it stands (paid / partly paid with
 * the figures / due / later), and its amount. A paid amount is struck through; a
 * later milestone is greyed so the client is not asked for everything at once.
 * `claimControl` is the row's small "I've made this payment" button, if any.
 */
export function PaymentScheduleRow({
  row,
  label,
  claimControl,
}: {
  row: PaymentRow;
  label: string;
  claimControl: ReactNode;
}) {
  const t = useTranslations('delivery.payments.state');
  const locale = useLocale();
  const stateText =
    row.state === 'partial'
      ? t('partial', {
          paid: bidiIsolate(formatPortalMoney(row.amountCleared, locale)),
          due: bidiIsolate(formatPortalMoney(row.amountDue, locale)),
        })
      : t(row.state);
  const greyed = row.state === 'later';

  return (
    <li className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-2.5 border-t py-2.5 first:border-t-0">
      <RowMarker row={row} />
      <div className="min-w-0 space-y-1">
        <p className={cn('text-sm font-semibold', greyed && 'text-muted-foreground')}>{label}</p>
        <p
          className={cn(
            'text-xs text-muted-foreground',
            row.isNext && 'font-semibold text-[color:var(--warn)]',
          )}
        >
          {stateText}
        </p>
        {claimControl}
      </div>
      <span
        dir="ltr"
        className={cn(
          'text-sm font-bold tabular-nums',
          (greyed || row.state === 'paid') && 'text-muted-foreground',
          row.state === 'paid' && 'line-through',
        )}
      >
        {formatPortalAmount(row.amountDue, locale)}
      </span>
    </li>
  );
}
