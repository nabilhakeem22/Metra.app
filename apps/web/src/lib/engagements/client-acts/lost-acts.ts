// What app_notify_lost_client_acts answered, narrowed (Round C, C11). PURE. The
// hourly sweep repairs studio notifications a client's first tap lost; each
// entry is one notifier call, and its `notified` is the notifier's own answer,
// so the emails that follow go exactly where a first tap's would have.
import { clientActOfBodyKey, type ClientAct } from './acts';
import { parseStudioNotified, type StudioNotified } from './studio-notified';

export interface RepairedAct {
  act: ClientAct;
  notified: StudioNotified;
}

/**
 * The repaired acts, or null when the function refused (its gate answers SQL
 * NULL). An entry whose key, milestone or notifier answer is not the documented
 * shape is dropped, never thrown: it cannot be emailed, and its in-app row (if
 * the notifier wrote one) already stands.
 */
export function parseLostActs(data: unknown): RepairedAct[] | null {
  if (!Array.isArray(data)) return null;
  const repaired: RepairedAct[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.body_key !== 'string') continue;
    const milestone = typeof row.milestone_kind === 'string' ? row.milestone_kind : null;
    const act = clientActOfBodyKey(row.body_key, milestone);
    const notified = parseStudioNotified(row.notified);
    if (act && notified) repaired.push({ act, notified });
  }
  return repaired;
}
