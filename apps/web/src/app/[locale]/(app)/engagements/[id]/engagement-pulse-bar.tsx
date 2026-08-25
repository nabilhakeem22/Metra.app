'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CommercialPulse } from '@/lib/engagements/pulse';
import { formatMoney } from '@/lib/format/money';

// The Commercial Pulse Bar (Slice 4) — the 3-cell strip that sits ABOVE the phase
// rail. Purely presentational over the server-computed `CommercialPulse` read-model
// (no money math here): contract total · collected-to-date (with %/fill) · the next
// pending gate and the phase clearing it unlocks. Money is rendered 2-dp via the
// shared serializer, `tabular-nums`, Western numerals in both locales. Palette
// tokens (`--ck-*`) are scoped to `.engagement-cockpit` in globals.css; logical CSS
// only (inline-start/end via grid + `border`) so the strip mirrors in ar-EG RTL.

export function EngagementPulseBar({ pulse }: { pulse: CommercialPulse }) {
  const t = useTranslations('engagements.pulse');
  const tk = useTranslations('engagements.milestoneKind');
  const tp = useTranslations('engagements.phase');
  const locale = useLocale();

  const { contractTotal, collected, collectedPct, pendingGate } = pulse;
  const fillWidth = Math.min(Math.max(collectedPct, 0), 100);

  return (
    <section className="engagement-cockpit grid grid-cols-1 gap-px overflow-hidden rounded-[14px] border border-[var(--ck-line)] bg-[var(--ck-line)] text-[var(--ck-ink)] shadow-sm sm:grid-cols-[1fr_1fr_1.6fr]">
      <div className="bg-[var(--ck-surface)] px-[18px] py-[14px]">
        <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--ck-faint)]">
          {t('contractTotal')}
        </div>
        <div
          className="text-[21px] font-semibold tabular-nums"
          dir="ltr"
        >
          {formatMoney(contractTotal, locale)}
        </div>
      </div>

      <div className="bg-[var(--ck-surface)] px-[18px] py-[14px]">
        <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--ck-faint)]">
          {t('collected')}
        </div>
        <div className="text-[21px] font-semibold tabular-nums" dir="ltr">
          {formatMoney(collected, locale)}
          <span className="ms-1 text-[12px] font-normal text-[var(--ck-muted)]">
            · {collectedPct}%
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--ck-line-strong)]">
          <div
            className="h-full bg-[var(--ck-accent-deep)]"
            style={{ inlineSize: `${fillWidth}%` }}
          />
        </div>
      </div>

      <div className="bg-[var(--ck-accent-soft)] px-[18px] py-[14px]">
        <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--ck-accent-ink)]">
          {t('pendingGate')}
        </div>
        {pendingGate ? (
          <>
            <div className="text-[21px] font-semibold tabular-nums" dir="ltr">
              {formatMoney(pendingGate.amountDue, locale)}
              <span className="ms-1 text-[12px] font-normal text-[var(--ck-muted)]">
                {t('due')}
              </span>
            </div>
            <div className="mt-1 text-[13px] text-[var(--ck-accent-ink)]">
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
            <div className="text-[21px] font-semibold text-[var(--ck-accent-ink)]">
              {t('noneOutstanding')}
            </div>
            <div className="mt-1 text-[13px] text-[var(--ck-muted)]">
              {t('allSettled')}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
