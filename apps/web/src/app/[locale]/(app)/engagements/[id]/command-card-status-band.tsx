'use client';

import { Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CommandCardChrome } from '@/lib/engagements/command-card-chrome';
import type { DesignState } from '@/lib/engagements/states';
import { EngagementStageSpine } from './engagement-stage-spine';

/**
 * The accent stripe — 4px on the inline-START, so it mirrors to the inline-END in
 * ar-EG RTL. Mode-driven colour, and the only thing that still carries the mode
 * once the pill is suppressed everywhere but `paymentToConfirm`.
 */
export function CommandCardAccentStripe({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-y-0 z-10 w-1 ${className}`}
      style={{ insetInlineStart: 0 }}
    />
  );
}

/**
 * 1. WHERE WE ARE — ribbon, status and whose-move in ONE tinted band.
 *
 * Grouping them is the point: two stacked strips read as two separate facts,
 * when they are one answer to "where is this".
 */
export function CommandCardStatusBand({
  state,
  chrome,
}: {
  state: DesignState;
  chrome: Pick<CommandCardChrome, 'showPaymentPill' | 'pillKey' | 'pillClass'>;
}) {
  const tcmd = useTranslations('engagements.command');
  return (
    <div
      className="border-b border-[color:var(--rule)] px-5 pb-4 pt-5 sm:px-6"
      style={{ background: 'var(--track)' }}
    >
      <EngagementStageSpine state={state} />
      {chrome.showPaymentPill && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <span
            className={`inline-flex items-center rounded-[var(--r-pill)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${chrome.pillClass}`}
          >
            {tcmd(`pill.${chrome.pillKey}`)}
          </span>
          <span className="text-[12.5px] text-[color:var(--text-muted)]">
            {tcmd('move.studio')}
          </span>
        </div>
      )}
    </div>
  );
}


/**
 * 4. QUIET FOOTER — present, never shouting. Its own band rather than a rule
 * inside the body, so the card reads as three regions: where we are, the one
 * action, and everything reachable from here.
 */
export function CommandCardShareFooter({ onNudge }: { onNudge: () => void }) {
  const tcmd = useTranslations('engagements.command');
  return (
    <div
      className="flex items-center gap-4 border-t border-[color:var(--rule)] px-5 py-3 sm:px-6"
      style={{ background: 'var(--track)' }}
    >
      <button
        type="button"
        onClick={onNudge}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-ink hover:underline"
      >
        <Link2 className="size-3.5" aria-hidden />
        {tcmd('nudge')}
      </button>
    </div>
  );
}
