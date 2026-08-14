import 'server-only';
import { automationRunLog, type MetraDb } from '@metra/db';

/**
 * Atomically claim `(automationKey, periodKey)` for an org. Runs INSIDE the org
 * RLS tx. The unique(org, automation_key, period_key) makes the insert the
 * admission gate: two overlapping runs both try, exactly one wins the returning
 * row. Returns true iff THIS call won the claim (and should do the work).
 */
export async function claimPeriod(
  tx: MetraDb,
  orgId: string,
  automationKey: string,
  periodKey: string,
): Promise<boolean> {
  const rows = await tx
    .insert(automationRunLog)
    .values({ orgId, automationKey, periodKey })
    .onConflictDoNothing({
      target: [
        automationRunLog.orgId,
        automationRunLog.automationKey,
        automationRunLog.periodKey,
      ],
    })
    .returning({ id: automationRunLog.id });
  return rows.length > 0;
}
