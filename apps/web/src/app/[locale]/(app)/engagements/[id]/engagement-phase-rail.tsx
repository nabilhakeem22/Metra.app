'use client';

import { useTranslations } from 'next-intl';
import { PHASE_GROUPS, phaseIndex, phaseOf } from '@/lib/engagements/phases';
import type { DesignState } from '@/lib/engagements/states';

// The five phase groups (Slice 1) rendered as the cockpit's top journey band.
// Purely presentational over the already-loaded engagement: the phase status is
// DERIVED from `currentState`, never stored. Reskinned to the glass system: a FLAT
// (opaque `bg-card`, no backdrop-filter) panel so it never adds to the cockpit's
// blur budget, with brand accents for the current phase and the semantic
// success/warn tokens for done/rework. Logical CSS only (inline-start/end) so the
// band mirrors correctly in ar-EG RTL.

type PhaseStatus = 'done' | 'current' | 'upcoming' | 'off';
type MicroStatus = 'done' | 'current' | 'upcoming' | 'rework';

/**
 * A micro-state is in intentional rework when it is `change_triage`, or when it
 * is `negotiation` after at least one revision has been spent. Rework is a
 * styling overlay — the forward progress marker never jumps backward for it.
 */
function isReworkState(state: DesignState, revisionCount: number): boolean {
  return (
    state === 'change_triage' || (state === 'negotiation' && revisionCount > 0)
  );
}

function phaseCardClass(status: PhaseStatus): string {
  switch (status) {
    case 'done':
      return 'border-transparent bg-[color:var(--success-tint)]';
    case 'current':
      return 'border-brand bg-brand-tint shadow-[0_0_0_3px_var(--brand-tint)]';
    default:
      return 'border-[color:var(--rule)] bg-card';
  }
}

function phaseNameClass(status: PhaseStatus): string {
  if (status === 'done') return 'text-[color:var(--success)]';
  if (status === 'current') return 'text-brand-ink';
  if (status === 'off') return 'text-[color:var(--text-muted)]';
  return 'text-[color:var(--text)]';
}

function microPillClass(status: MicroStatus): string {
  switch (status) {
    case 'done':
      return 'bg-[color:var(--success-tint)] text-[color:var(--success)]';
    case 'current':
      return 'bg-brand font-semibold text-brand-foreground';
    case 'rework':
      return 'bg-[color:var(--warn-tint)] font-semibold text-[color:var(--warn)]';
    default:
      return 'border border-dashed border-[color:var(--rule)] bg-transparent text-[color:var(--text-muted)]';
  }
}

function microDotClass(status: MicroStatus): string {
  switch (status) {
    case 'done':
      return 'bg-[color:var(--success)]';
    case 'current':
      return 'bg-brand-foreground';
    case 'rework':
      return 'bg-[color:var(--warn)]';
    default:
      return 'bg-[color:var(--rule)]';
  }
}

export function EngagementPhaseRail({
  currentState,
  revisionCount,
}: {
  currentState: DesignState;
  revisionCount: number;
}) {
  const t = useTranslations('engagements');

  const activePhaseKey = phaseOf(currentState);
  const currentPhaseIndex = activePhaseKey ? phaseIndex(activePhaseKey) : -1;
  const offFunnel = currentPhaseIndex < 0;

  const currentGroup = offFunnel ? null : PHASE_GROUPS[currentPhaseIndex];
  const currentMicroIndex = currentGroup
    ? currentGroup.states.indexOf(currentState)
    : -1;

  return (
    <section className="rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-card p-4 text-[color:var(--text)] shadow-sm">
      <header className="mb-3 flex items-baseline justify-between gap-3 px-0.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
          {t('rail.title')}
        </span>
        <span className="text-xs text-[color:var(--text-muted)]">
          {offFunnel
            ? t('rail.offFunnel')
            : t('rail.progress', {
                current: currentPhaseIndex + 1,
                total: PHASE_GROUPS.length,
              })}
        </span>
      </header>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {PHASE_GROUPS.map((group, index) => {
          const status: PhaseStatus = offFunnel
            ? 'off'
            : index < currentPhaseIndex
              ? 'done'
              : index === currentPhaseIndex
                ? 'current'
                : 'upcoming';
          return (
            <li
              key={group.key}
              className={`rounded-[var(--r-item)] border p-3 ${phaseCardClass(status)}`}
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <div className="font-mono text-[10.5px] tabular-nums text-[color:var(--text-faint)]">
                {String(index + 1).padStart(2, '0')}
              </div>
              <div
                className={`mt-0.5 text-[13px] font-semibold leading-tight ${phaseNameClass(status)}`}
              >
                {t(`phase.${group.key}`)}
              </div>
              {status !== 'off' && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">
                  {status === 'done' && (
                    <span
                      className="inline-grid h-[15px] w-[15px] place-items-center rounded-full bg-[color:var(--success)] text-[9px] text-white"
                      aria-hidden
                    >
                      ✓
                    </span>
                  )}
                  {status === 'current' && (
                    <span
                      className="inline-grid h-[15px] w-[15px] place-items-center rounded-full bg-brand text-[9px] text-brand-foreground"
                      aria-hidden
                    >
                      •
                    </span>
                  )}
                  <span
                    className={status === 'done' ? 'text-[color:var(--success)]' : ''}
                  >
                    {t(`phaseStatus.${status}`)}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {currentGroup && (
        <ol className="mt-3 flex flex-wrap gap-1.5 border-t border-dashed border-[color:var(--rule)] pt-3">
          {currentGroup.states.map((state, microIndex) => {
            const status: MicroStatus = isReworkState(state, revisionCount)
              ? 'rework'
              : microIndex < currentMicroIndex
                ? 'done'
                : microIndex === currentMicroIndex
                  ? 'current'
                  : 'upcoming';
            return (
              <li
                key={state}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] ${microPillClass(status)}`}
                aria-current={status === 'current' ? 'step' : undefined}
              >
                <span
                  className={`h-2 w-2 rounded-full ${microDotClass(status)}`}
                  aria-hidden
                />
                {t(`state.${state}`)}
                {status === 'rework' && (
                  <span aria-label={t('phaseStatus.rework')}>↺</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
