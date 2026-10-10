import 'server-only';
// How often a change to the client page details may alert (Round C, C8 fix
// round S4). Every change is AUDITED; the ALERT (an in-app notification to
// every owner and admin, then an email each) is merged and capped:
//   - one alert per actor per Cairo hour: the FIRST change an actor makes in an
//     hour always alerts, and their later changes that hour are already covered
//     by it (it opens Settings, which shows the current values);
//   - a second actor in the same hour is alerted on their own, so a change can
//     never hide behind a colleague's;
//   - at most ALERT_EMAIL_BATCHES_PER_HOUR email batches per org per hour; past
//     that the alert is in-app only, so a loop of saves cannot spend the shared
//     mail quota.
// Claims are `automation_run_log` rows written in the save's own transaction,
// so a save that rolls back claims nothing.
import type { MetraDb } from '@metra/db';
import { claimPeriod } from '@/lib/automation/claim';
import { cairoHourKey } from '@/lib/automation/clock';

export const ALERT_EMAIL_BATCHES_PER_HOUR = 3;

export interface AlertAllowance {
  /** Write the in-app notifications for this change. */
  notify: boolean;
  /** Also email them. */
  email: boolean;
}

export async function claimAlert(
  tx: MetraDb,
  orgId: string,
  actorUserId: string,
  now: Date,
): Promise<AlertAllowance> {
  const hour = cairoHourKey(now);
  if (!(await claimPeriod(tx, orgId, 'client-page-alert', `${hour}:${actorUserId}`))) {
    return { notify: false, email: false };
  }
  for (let batch = 1; batch <= ALERT_EMAIL_BATCHES_PER_HOUR; batch += 1) {
    if (await claimPeriod(tx, orgId, 'client-page-alert-email', `${hour}:${batch}`)) {
      return { notify: true, email: true };
    }
  }
  return { notify: true, email: false };
}
