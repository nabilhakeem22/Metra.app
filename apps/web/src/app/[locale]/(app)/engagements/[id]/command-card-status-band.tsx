'use client';

import { Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DesignState } from '@/lib/engagements/states';
import { EngagementStageSpine } from './engagement-stage-spine';

/**
 * The accent stripe: 4px on the inline-START, so it mirrors to the inline-END in
 * ar-EG RTL. Its colour is the delivery status's (command-card-chrome.ts).
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
 * 1. WHERE WE ARE: the stage ribbon in one tinted band. Whose move it is lives
 * in the header's status chip, and the card wears its colour; it is never said
 * a second time here.
 */
export function CommandCardStatusBand({ state }: { state: DesignState }) {
  return (
    <div
      className="border-b border-[color:var(--rule)] px-5 pb-4 pt-5 sm:px-6"
      style={{ background: 'var(--track)' }}
    >
      <EngagementStageSpine state={state} />
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
        className="inline-flex items-center gap-1.5 text-small font-semibold text-brand-ink hover:underline"
      >
        <Link2 className="size-3.5" aria-hidden />
        {tcmd('nudge')}
      </button>
    </div>
  );
}
