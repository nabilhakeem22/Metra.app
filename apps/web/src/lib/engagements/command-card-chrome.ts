import type { CommandCardMode } from './command-card';

// The command card's CHROME, as a pure function of its mode. No React, no
// `server-only`, no db: which colour family the card wears and which pill it
// shows is a product rule, and a rule spelled out as four nested ternaries inside
// a 515-line component is one nobody can test and everybody edits.

/** Mode-driven accent: amber for the blocked attention states, brand for ready,
 *  neutral for closed — expressed through the app's semantic tokens so both
 *  themes and RTL stay correct. */
type CommandCardAccent = 'neutral' | 'brand' | 'warn';

export interface CommandCardChrome {
  accent: CommandCardAccent;
  stripeClass: string;
  pillClass: string;
  borderClass: string;
  /**
   * ONE highlighted statement of where things stand, not two. In every mode but
   * one the pill and the headline two lines below say the same thing —
   * identically for blockedClient ("Waiting on the client" / "Waiting on the
   * client"), near enough for the others — and the headline is the better of the
   * pair because it also names the phase. So the pill renders ONLY for
   * `paymentToConfirm`, where it names a TASK the headline does not: the headline
   * there reads "waiting on the client" while a claim actually sits with the
   * studio. The mode's colour is not lost with it — the accent stripe and the
   * border still carry it.
   */
  showPaymentPill: boolean;
  /** The key under `engagements.command.pill`. */
  pillKey: CommandCardPillKey;
  /** True when every unmet guard is one the CLIENT clears, so there is no studio action. */
  waitingOnClient: boolean;
}

export type CommandCardPillKey =
  | 'closed'
  | 'ready'
  | 'studio'
  | 'paymentToConfirm'
  | 'waitingClient';

/**
 * The human status pill, pure from the command view + the pending
 * client-payment-claim count. blockedClient with a pending claim reads as
 * "payment to confirm" (the studio's move to record it), not "waiting on client".
 */
export function derivePillKey(
  mode: CommandCardMode,
  paymentClaimCount: number,
): CommandCardPillKey {
  switch (mode) {
    case 'closed':
      return 'closed';
    case 'ready':
      return 'ready';
    case 'blockedStudio':
      return 'studio';
    default:
      return paymentClaimCount > 0 ? 'paymentToConfirm' : 'waitingClient';
  }
}

function accentFor(mode: CommandCardMode): CommandCardAccent {
  if (mode === 'closed') return 'neutral';
  return mode === 'ready' ? 'brand' : 'warn';
}

const STRIPE: Record<CommandCardAccent, string> = {
  warn: 'bg-[color:var(--warn)]',
  brand: 'bg-brand',
  neutral: 'bg-[color:var(--rule)]',
};

const PILL: Record<CommandCardAccent, string> = {
  warn: 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]',
  brand: 'bg-brand-tint text-brand-ink',
  neutral: 'bg-[color:var(--track)] text-[color:var(--text-muted)]',
};

const BORDER: Record<CommandCardAccent, string> = {
  warn: 'border-[color:var(--warn-tint)]',
  brand: 'border-[color:var(--brand-tint-border)]',
  neutral: 'border-[color:var(--rule)]',
};

export function resolveCommandCardChrome(options: {
  mode: CommandCardMode;
  paymentClaimCount: number;
}): CommandCardChrome {
  const accent = accentFor(options.mode);
  const pillKey = derivePillKey(options.mode, options.paymentClaimCount);
  return {
    accent,
    stripeClass: STRIPE[accent],
    pillClass: PILL[accent],
    borderClass: BORDER[accent],
    showPaymentPill: pillKey === 'paymentToConfirm',
    pillKey,
    waitingOnClient: options.mode === 'blockedClient',
  };
}
