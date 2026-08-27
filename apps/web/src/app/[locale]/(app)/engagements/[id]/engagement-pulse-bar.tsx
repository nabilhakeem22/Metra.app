'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CommercialPulse } from '@/lib/engagements/pulse';
import { formatMoney } from '@/lib/format/money';

// The Commercial Pulse Bar (Slice 4) — the 3-cell strip that sits ABOVE the phase
// rail. Purely presentational over the server-computed `CommercialPulse` read-model
// (no money math here): contract total · collected-to-date (with %/fill) · the next
// pending gate and the phase clearing it unlocks. Money is rendered 2-dp via the
// shared serializer, `tabular-nums`, Western numerals in both locales. Reskinned to
// the glass system as a FLAT (opaque `bg-card` cells over a `--rule` hairline grid,
// no backdrop-filter) panel so it stays off the cockpit blur budget; the pending
// gate cell wears the brand tint. Logical CSS only (grid + `border`) so the strip
// mirrors in ar-EG RTL.

export function EngagementPulseBar({ pulse }: { pulse: CommercialPulse }) {
  const t = useTranslations('engagements.pulse');
  const tk = useTranslations('engagements.milestoneKind');
  const tp = useTranslations('engagements.phase');
  const locale = useLocale();

  const { contractTotal, collected, collectedPct, pendingGate } = pulse;
  const fillWidth = Math.min(Math.max(collectedPct, 0), 100);

  return (
    <section className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-[color:var(--rule)] text-[color:var(--text)] shadow-sm sm:grid-cols-[1fr_1fr_1.6fr]">
      <div className="bg-card px-[18px] py-[14px]">
        <div className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
          {t('contractTotal')}
        </div>
        <div
          className="text-[21px] font-semibold tabular"
          dir="ltr"
        >
          {formatMoney(contractTotal, locale)}
        </div>
      </div>

      <div className="bg-card px-[18px] py-[14px]">
        <div className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
          {t('collected')}
        </div>
        <div className="text-[21px] font-semibold tabular" dir="ltr">
          {formatMoney(collected, locale)}
          <span className="ms-1 text-[12px] font-normal text-[color:var(--text-muted)]">
            · {collectedPct}%
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--track)]">
          <div
            className="h-full bg-brand"
            style={{ inlineSize: `${fillWidth}%` }}
          />
        </div>
      </div>

      <div className="bg-brand-tint px-[18px] py-[14px]">
        <div className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-ink">
          {t('pendingGate')}
        </div>
        {pendingGate ? (
          <>
            <div className="text-[21px] font-semibold tabular" dir="ltr">
              {formatMoney(pendingGate.amountDue, locale)}
              <span className="ms-1 text-[12px] font-normal text-[color:var(--text-muted)]">
                {t('due')}
              </span>
            </div>
            <div className="mt-1 text-[13px] text-brand-ink">
              {pendingGate.unlocksPhaseKey
                ? t('unlocks', {
                    gate: tk(pendingGate.gate),
                    phase: tp(pendingGate.unlocksPhaseKey),
                  })
                : t('clears', { gate: tk(pendingGate.gate) })}
            </div>
          </>
        ) : (
          <>
            <div className="text-[21px] font-semibold text-brand-ink">
              {t('noneOutstanding')}
            </div>
            <div className="mt-1 text-[13px] text-[color:var(--text-muted)]">
              {t('allSettled')}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
