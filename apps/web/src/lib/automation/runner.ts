import 'server-only';
import { automationSettings, organizations } from '@metra/db';
import { eq } from 'drizzle-orm';
import { runExpireProposals } from './expire-proposals';
import { runFollowupReminders } from './followup-reminders';
import { runPortfolioDigest } from './portfolio-digest';
import { runStageReminders } from './stage-reminders';
import { resolveSystemContext } from './system-context';
import type {
  AutomationKey,
  AutomationResult,
  AutomationRunSummary,
} from './types';
import { withRequestDb } from '@/lib/db/client';

const CORES: Array<{
  key: AutomationKey;
  run: (deps: Parameters<typeof runExpireProposals>[0]) => Promise<AutomationResult>;
}> = [
  { key: 'expire', run: runExpireProposals },
  { key: 'followup', run: runFollowupReminders },
  { key: 'digest', run: runPortfolioDigest },
  { key: 'stage', run: runStageReminders },
];

function skipped(key: AutomationKey): AutomationResult {
  return { automation: key, ran: false, effects: 0, emailsSent: 0, emailsFailed: 0 };
}

/**
 * The session-less automation tick. On the PRIVILEGED connection it reads ONLY
 * system tables (organizations, automation_settings, memberships) to enumerate
 * orgs and their config — it NEVER touches a business table privileged. For each
 * org it resolves a system actor (earliest owner, fallback admin) and dispatches
 * the four cores, each of which does ALL business reads/writes inside a single-org
 * withOrgContext RLS tx keyed on that actor. Cores are isolated by per-org,
 * per-automation try/catch so one failure never aborts the tick. Never throws.
 */
export async function runDueAutomations(
  now: Date = new Date(),
): Promise<AutomationRunSummary> {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ?? '';
  const results: AutomationRunSummary['results'] = [];
  let orgsProcessed = 0;

  const orgs = await withRequestDb((db) =>
    db
      .select({ id: organizations.id, defaultLocale: organizations.defaultLocale })
      .from(organizations),
  );

  for (const org of orgs) {
    const ctx = await resolveSystemContext(org.id);
    if (!ctx) continue; // no owner/admin — nothing to act as; skip.

    const [settings] = await withRequestDb((db) =>
      db
        .select()
        .from(automationSettings)
        .where(eq(automationSettings.orgId, org.id))
        .limit(1),
    );
    if (!settings) continue; // no config row — skip (backfilled for all orgs).

    orgsProcessed += 1;
    const locale = org.defaultLocale ?? 'ar-EG';

    for (const core of CORES) {
      try {
        const r = await core.run({ ctx, settings, now, locale, appUrl });
        results.push({ orgId: org.id, ...r });
      } catch (err) {
        console.error(
          `automation "${core.key}" failed for org ${org.id}:`,
          err,
        );
        results.push({ orgId: org.id, ...skipped(core.key) });
      }
    }
  }

  return { ranAt: now.toISOString(), orgsProcessed, results };
}
