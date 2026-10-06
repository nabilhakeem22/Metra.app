import { useTranslations } from 'next-intl';
import type { WhoseMove } from '@/lib/engagements/whose-move';

// NOT 'use client': the dashboard panel (a server component) and the deliveries
// list (a client component) both render it, and `useTranslations` works in each.

const CHIP_TONE: Record<WhoseMove, string> = {
  client: 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]',
  studio: 'bg-brand-tint text-brand-ink',
  confirmPayment: 'bg-brand-tint text-brand-ink',
  closed: 'bg-[color:var(--track)] text-[color:var(--text-muted)]',
};

/** Whose move it is on a delivery, by the same rule the delivery page reads. */
export function WhoseMoveChip({ whoseMove }: { whoseMove: WhoseMove }) {
  const t = useTranslations('engagements.whoseMove');
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-pill px-2 py-1 text-[11.5px] font-bold ${CHIP_TONE[whoseMove]}`}
    >
      {t(whoseMove)}
    </span>
  );
}
