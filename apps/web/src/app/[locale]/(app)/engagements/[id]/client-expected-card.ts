// The command card's "when should the client expect the next step?" control,
// derived on the SERVER from what the page already loaded (no extra read), so
// "today" is Cairo's today and the header and the card agree. A plain module.
import type { MemberRole } from '@metra/db';
import { addDays, todayInCairo } from '@/lib/automation/clock';
import {
  CLIENT_EXPECTED_MAX_DAYS_AHEAD,
  clientExpectedViewOf,
  type ClientExpectedView,
} from '@/lib/engagements/client-expected-view';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import type { EngagementHeader, EngagementTransitionRecord } from '@/lib/engagements/queries';
import { isTerminal } from '@/lib/engagements/states';
import { can } from '@/lib/permissions/can';

export interface ClientExpectedCard {
  view: ClientExpectedView;
  /** The date input's bounds: today and a year ahead, in Cairo. */
  min: string;
  max: string;
}

/**
 * The control, or null when it is not offered: a role without
 * `engagements_design` update, a finished delivery, or a delivery that waits
 * on the client (the date promises the STUDIO's next step).
 */
export function clientExpectedCardOf(input: {
  role: MemberRole;
  header: EngagementHeader;
  transitions: readonly EngagementTransitionRecord[];
  status: DeliveryStatus;
  now: Date;
}): ClientExpectedCard | null {
  const { header, status } = input;
  const studioMove = status.kind === 'yourMove' || status.kind === 'confirmPayment';
  if (!studioMove || isTerminal(header.state) || !can(input.role, 'engagements_design', 'update')) return null;
  const today = todayInCairo(input.now);
  return {
    view: clientExpectedViewOf({
      expected: header.clientExpected,
      state: header.state,
      transitions: input.transitions,
      today,
    }),
    min: today,
    max: addDays(today, CLIENT_EXPECTED_MAX_DAYS_AHEAD),
  };
}
