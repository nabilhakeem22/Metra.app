'use client';

import type { useTranslations } from 'next-intl';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import { formatMoneyExact } from '@/lib/format/money';

// The machine-truthful guard checklist inside the cockpit hero. Purely
// presentational; rendered by the parent only when there are items to show.
export function EngagementHeroChecklist({
  th,
  tg,
  locale,
  items,
}: {
  th: ReturnType<typeof useTranslations<'engagements.hero'>>;
  tg: ReturnType<typeof useTranslations<'engagements.guard'>>;
  locale: string;
  items: EngagementGatePreview['items'];
}) {
  return (
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
  );
}
