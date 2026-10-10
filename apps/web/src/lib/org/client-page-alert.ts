import 'server-only';
// When a change to the client page details is also EMAILED (Round C, C8; owner
// rule restored at the wave 3 gate). EVERY change to the phone, WhatsApp,
// InstaPay or bank details notifies every owner and admin in the app, naming
// every field that save changed; nothing here can withhold that. Only the
// email is limited:
//   - the same actor saving exactly the same set of fields again within the
//     Cairo hour is not emailed twice (the in-app notification still lands);
//   - at most ALERT_EMAIL_BATCHES_PER_HOUR email batches per org per hour, so
//     a loop of saves cannot spend the shared mail quota; past that the alert
//     is in-app only.
// Both are `automation_run_log` claims written in the save's own transaction,
// so a save that rolls back claims nothing.
import type { MetraDb } from '@metra/db';
import { claimPeriod } from '@/lib/automation/claim';
import { cairoHourKey } from '@/lib/automation/clock';
import type { ClientPageField } from './client-page-details';

export const ALERT_EMAIL_BATCHES_PER_HOUR = 3;

/** Whether this change's alert is also emailed. The in-app notification never depends on it. */
export async function claimAlertEmail(
  tx: MetraDb,
  orgId: string,
  actorUserId: string,
  fields: readonly ClientPageField[],
  now: Date,
): Promise<boolean> {
  const hour = cairoHourKey(now);
  const fieldSet = [...fields].sort().join(',');
  if (!(await claimPeriod(tx, orgId, 'client-page-alert', `${hour}:${actorUserId}:${fieldSet}`))) return false;
  for (let batch = 1; batch <= ALERT_EMAIL_BATCHES_PER_HOUR; batch += 1) {
    if (await claimPeriod(tx, orgId, 'client-page-alert-email', `${hour}:${batch}`)) return true;
  }
  return false;
}
