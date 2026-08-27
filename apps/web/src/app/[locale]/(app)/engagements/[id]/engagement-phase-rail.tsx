'use client';

import { useTranslations } from 'next-intl';
import { PHASE_GROUPS, phaseIndex, phaseOf } from '@/lib/engagements/phases';
import type { DesignState } from '@/lib/engagements/states';

// The five phase groups (Slice 1) rendered as the cockpit's top journey band —
// reproducing the mockup's bordered PILL RAIL: a single horizontal-scroll strip of
// one pill per phase. Purely presentational over the already-loaded engagement: the
// phase status is DERIVED from `currentState`, never stored.
//   • done    → a filled brand dot (✓) + muted text.
//   • current → a brand-soft fill + brand-line border + brand-ink text + a hollow
//               brand dot.
//   • future  → a grey numbered dot + faint text.
// FLAT (opaque `bg-card`, no backdrop-filter) so it never adds to the cockpit's
// blur budget. Logical CSS only (inline-start/end + `overflow-x`) so the band
// mirrors correctly in ar-EG RTL.

type PhaseStatus = 'done' | 'current' | 'upcoming';

function pillClass(status: PhaseStatus): string {
  switch (status) {
    case 'done':
      return 'border-transparent text-[color:var(--text-muted)]';
    case 'current':
      return 'border-[color:var(--brand-tint-border)] bg-brand-tint text-brand-ink';
    default:
      return 'border-transparent text-[color:var(--text-faint)]';
  }
}

function dotClass(status: PhaseStatus): string {
  switch (status) {
    case 'done':
      return 'border-brand bg-brand text-brand-foreground';
    case 'current':
      return 'border-brand bg-card text-brand';
    default:
      return 'border-[color:var(--rule)] text-[color:var(--text-faint)]';
  }
}

export function EngagementPhaseRail({
  currentState,
  revisionCount: _revisionCount,
}: {
  currentState: DesignState;
  // Kept in the props contract (the page passes it) though the pill rail derives
  // its status purely from the current phase — no per-state rework overlay here.
  revisionCount: number;
}) {
  const t = useTranslations('engagements');

  const activePhaseKey = phaseOf(currentState);
  const currentPhaseIndex = activePhaseKey ? phaseIndex(activePhaseKey) : -1;
  const offFunnel = currentPhaseIndex < 0;

  return (
    <section className="overflow-x-auto rounded-[var(--r-item)] border border-[color:var(--rule)] bg-card p-2 text-[color:var(--text)] shadow-sm">
      <ol className="flex gap-[7px]">
        {PHASE_GROUPS.map((group, index) => {
          const status: PhaseStatus = offFunnel
            ? 'upcoming'
            : index < currentPhaseIndex
              ? 'done'
              : index === currentPhaseIndex
                ? 'current'
                : 'upcoming';
          const glyph =
            status === 'done' ? '✓' : status === 'current' ? '●' : String(index + 1);
          return (
            <li
              key={group.key}
              className={`flex flex-1 items-center gap-2 whitespace-nowrap rounded-[var(--r-item)] border px-2.5 py-2.5 text-[12px] font-semibold [min-inline-size:120px] ${pillClass(status)}`}
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <span
                className={`grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-2 text-[9px] font-bold ${dotClass(status)}`}
                aria-hidden
              >
                {glyph}
              </span>
              {t(`phase.${group.key}`)}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
