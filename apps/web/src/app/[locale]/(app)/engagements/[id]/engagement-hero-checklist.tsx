'use client';

import type { useTranslations } from 'next-intl';
import { CLIENT_ACTIONABLE_GUARDS } from '@/lib/engagements/command-card';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import { formatMoneyExact } from '@/lib/format/money';

// The machine-truthful guard checklist inside the cockpit command card, matching
// the mockup's `.checklist`: each row is a circular mark (green ✓ done / amber ●
// pending) + a bold title + a small subtext line. A pending row the CLIENT clears
// by acting on the delivery link carries a "Nudge client" pill on the inline-END
// (reveals the existing share link — no new action). Purely presentational;
// rendered by the parent only when there are items to show. `showNudgePill`
// mirrors the command view's `showNudge && canShare`.
export function EngagementHeroChecklist({
  th,
  tg,
  locale,
  items,
  showNudgePill,
  nudgeLabel,
  onNudge,
}: {
  th: ReturnType<typeof useTranslations<'engagements.hero'>>;
  tg: ReturnType<typeof useTranslations<'engagements.guard'>>;
  locale: string;
  items: EngagementGatePreview['items'];
  showNudgePill: boolean;
  nudgeLabel: string;
  onNudge: () => void;
}) {
  return (
    <ul className="mb-5 grid gap-0.5">
      {items.map((item) => {
        const clientActionable =
          !item.ok && CLIENT_ACTIONABLE_GUARDS.has(item.guard);
        return (
          <li
            key={item.guard}
            className="flex items-center gap-3 py-2 text-[13.5px]"
          >
            <span
              className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-xs font-extrabold ${
                item.ok
                  ? 'bg-[color:var(--success-tint)] text-[color:var(--success)]'
                  : 'border-[1.5px] border-[color:var(--warn-tint)] bg-[color:var(--warn-tint)] text-[color:var(--warn)]'
              }`}
              aria-hidden
            >
              {item.ok ? '✓' : '●'}
            </span>

            <span className="min-w-0">
              <span
                className={
                  item.ok
                    ? 'block text-[color:var(--text-muted)]'
                    : 'block font-semibold'
                }
              >
                {tg(item.guard)}
              </span>
              {item.amountDue && (
                <span className="mt-0.5 flex items-baseline gap-1.5 text-[11.5px]">
                  <span className="text-[color:var(--text-faint)]">
                    {th('dueLabel')}
                  </span>
                  {/* Exact shortfall (told = charged): must match what the form
                      pre-fills and recordPaymentCore charges — a 2dp round could
                      overstate it by ~0.005 EGP. Only the money is dir=ltr so the
                      currency symbol always sits after the number in both locales. */}
                  <span
                    className="font-mono tabular-nums text-[color:var(--warn)]"
                    dir="ltr"
                  >
                    {formatMoneyExact(item.amountDue, locale)}
                  </span>
                </span>
              )}
            </span>

            {showNudgePill && clientActionable && (
              <button
                type="button"
                onClick={onNudge}
                className="ms-auto shrink-0 rounded-[var(--r-pill)] border border-[color:var(--brand-tint-border)] bg-brand-tint px-2.5 py-1 text-[12px] font-semibold text-brand-ink"
              >
                {nudgeLabel}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
