'use client';

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
