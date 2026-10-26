import type { StatusTone } from '@/lib/ui/status-tone';
import { deliveryStatusTone, type DeliveryStatus } from './delivery-status';

// The command card's CHROME, as a pure function of the delivery's status. No
// React, no `server-only`, no db: which colour family the card wears is a
// product rule, and it is the SAME status the header chip, the deliveries list
// and the dashboard say in words. Blocked on the studio and waiting on the
// client used to wear the same amber; now brand means "your move", neutral means
// "waiting", amber only "stalled" and green "delivered".

export interface CommandCardChrome {
  /** The 4px accent stripe on the inline-start edge. */
  stripeClass: string;
  borderClass: string;
}

const CHROME_BY_TONE: Record<StatusTone, CommandCardChrome> = {
  yourMove: { stripeClass: 'bg-brand', borderClass: 'border-[color:var(--brand-tint-border)]' },
  waiting: { stripeClass: 'bg-[color:var(--rule)]', borderClass: 'border-[color:var(--rule)]' },
  neutral: { stripeClass: 'bg-[color:var(--rule)]', borderClass: 'border-[color:var(--rule)]' },
  draft: { stripeClass: 'bg-[color:var(--rule)]', borderClass: 'border-[color:var(--rule)]' },
  stalled: {
    stripeClass: 'bg-[color:var(--warn)]',
    borderClass: 'border-[color:var(--warn-tint)]',
  },
  done: {
    stripeClass: 'bg-[color:var(--success)]',
    borderClass: 'border-[color:var(--success-tint)]',
  },
};

/** The chrome a status tone wears: the client home's step card reads it from the client's own move. */
export function commandCardChromeForTone(tone: StatusTone): CommandCardChrome {
  return CHROME_BY_TONE[tone];
}

export function resolveCommandCardChrome(status: DeliveryStatus): CommandCardChrome {
  return commandCardChromeForTone(deliveryStatusTone(status));
}
