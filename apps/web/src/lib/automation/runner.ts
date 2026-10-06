import 'server-only';
import { automationSettings, organizations, type AutomationSettings } from '@metra/db';
import { asc } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { settleWithConcurrency } from './concurrency';
import { runExpireProposals } from './expire-proposals';
import { runFollowupReminders } from './followup-reminders';
import { runPortfolioDigest } from './portfolio-digest';
import { createRecipientEmailLookup } from './recipients';
import { summarizeTick, tickLogLine } from './run-summary';
import { runStageReminders } from './stage-reminders';
import { resolveSystemContext } from './system-context';
import type {
  AutomationDeps,
  AutomationKey,
  AutomationResult,
  AutomationRunSummary,
  OrgAutomationResult,
  OrgRunOutcome,
} from './types';
import { withRequestDb } from '@/lib/db/client';

/**
 * Orgs worked on at once. Each org's cores stay sequential, so an org holds at
 * most ONE database connection and makes at most ONE outbound HTTP call
 * (Supabase auth or Resend) at a time. Three orgs is therefore at most three
 * sockets on the request's shared pool, under its `max: 5` (lib/db/client.ts),
 * plus three fetches: exactly Cloudflare's six simultaneous open connections per
 * invocation. Past six, Cloudflare queues new connections until one closes, so
 * a higher number would stall rather than speed anything up.
 */
export const ORG_CONCURRENCY = 3;

const CORES: Array<{
  key: AutomationKey;
  run: (deps: AutomationDeps) => Promise<AutomationResult>;
}> = [
  { key: 'expire', run: runExpireProposals },
  { key: 'followup', run: runFollowupReminders },
  { key: 'digest', run: runPortfolioDigest },
  { key: 'stage', run: runStageReminders },
];

/** Everything shared by every org on one tick. */
type TickDeps = Pick<AutomationDeps, 'now' | 'appUrl' | 'lookupRecipientEmail'>;
type OrgRow = { id: string; defaultLocale: string | null };

function failedCore(orgId: string, key: AutomationKey): OrgAutomationResult {
  return {
    orgId,
    automation: key,
    failed: true,
    ran: false,
    effects: 0,
    emailsSent: 0,
    emailsFailed: 0,
  };
}

/** The four cores for one org, in order; one throwing never stops the next. */
async function runCores(deps: AutomationDeps): Promise<OrgAutomationResult[]> {
  const orgId = deps.ctx.orgId;
  const results: OrgAutomationResult[] = [];
  for (const core of CORES) {
    try {
      results.push({ orgId, failed: false, ...(await core.run(deps)) });
    } catch (err) {
      console.error(
        `automation "${core.key}" failed for org ${orgId}:`,
        loggableFailure(err),
      );
      results.push(failedCore(orgId, core.key));
    }
  }
  return results;
}

async function runOrg(
  org: OrgRow,
  settings: AutomationSettings | undefined,
  tick: TickDeps,
): Promise<OrgRunOutcome> {
  if (!settings) return { orgId: org.id, status: 'skipped' }; // no config row
  const ctx = await resolveSystemContext(org.id);
  if (!ctx) return { orgId: org.id, status: 'skipped' }; // no owner/admin to act as
  const locale = org.defaultLocale ?? 'ar-EG';
  const results = await runCores({ ...tick, ctx, settings, locale });
  return { orgId: org.id, status: 'processed', results };
}

/** Orgs in id order, so every tick walks them in the same sequence. */
function readOrgsInIdOrder(): Promise<OrgRow[]> {
  return withRequestDb((db) =>
    db
      .select({ id: organizations.id, defaultLocale: organizations.defaultLocale })
      .from(organizations)
      .orderBy(asc(organizations.id)),
  );
}

/** Every org's settings row in ONE read, keyed by org id. */
async function readSettingsByOrg(): Promise<Map<string, AutomationSettings>> {
  const rows = await withRequestDb((db) => db.select().from(automationSettings));
  return new Map(rows.map((row) => [row.orgId, row]));
}

/** A rejected org becomes a `failed` outcome, logged by shape only. */
function orgOutcomeOf(
  orgId: string,
  settled: PromiseSettledResult<OrgRunOutcome>,
): OrgRunOutcome {
  if (settled.status === 'fulfilled') return settled.value;
  console.error(`automation setup failed for org ${orgId}:`, loggableFailure(settled.reason));
  return { orgId, status: 'failed' };
}

/**
 * The session-less automation tick. On the PRIVILEGED connection it reads ONLY
 * system tables (organizations, automation_settings, memberships) to enumerate
 * orgs and their config — it NEVER touches a business table privileged. For each
 * org it resolves a system actor (earliest owner, fallback admin) and dispatches
 * the four cores, each of which does ALL business reads/writes inside a single-org
 * withOrgContext RLS tx keyed on that actor. Orgs run ORG_CONCURRENCY at a time;
 * per-org and per-core isolation means one failure never aborts the others. Logs
 * one count-only summary line. Throws only if the org or settings list itself
 * cannot be read (the route answers 500).
 */
export async function runDueAutomations(
  now: Date = new Date(),
): Promise<AutomationRunSummary> {
  const startedAt = Date.now();
  const tick: TickDeps = {
    now,
    appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ?? '',
    lookupRecipientEmail: createRecipientEmailLookup(),
  };
  const orgs = await readOrgsInIdOrder();
  const settingsByOrg = await readSettingsByOrg();

  const settled = await settleWithConcurrency(orgs, ORG_CONCURRENCY, (org) =>
    runOrg(org, settingsByOrg.get(org.id), tick),
  );
  const outcomes = settled.map((outcome, index) => orgOutcomeOf(orgs[index].id, outcome));

  const summary = summarizeTick(outcomes, now, Date.now() - startedAt);
  console.info(tickLogLine(summary));
  return summary;
}
