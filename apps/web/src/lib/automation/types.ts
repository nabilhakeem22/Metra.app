import type { AutomationSettings } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';

/** One of the four automation cores. */
export type AutomationKey = 'expire' | 'followup' | 'digest' | 'stage';

/**
 * Where an internal user's email address came from on this tick. `failed` is a
 * lookup that errored or ran out of time; `no-address` is a user with no email
 * on file, which is not a failure.
 */
export type RecipientLookup =
  | { status: 'found'; email: string }
  | { status: 'no-address' }
  | { status: 'failed' };

/** Resolves a user id to their email, memoised for one tick (see recipients.ts). */
export type RecipientEmailLookup = (userId: string) => Promise<RecipientLookup>;

/**
 * Everything a core needs, resolved once per org by the runner: the system-actor
 * OrgContext (owner), that org's settings row, the run instant, the org's default
 * locale (for email copy), the absolute app origin (for links), and the tick's
 * shared recipient lookup.
 */
export interface AutomationDeps {
  ctx: OrgContext;
  settings: AutomationSettings;
  now: Date;
  locale: string;
  appUrl: string;
  lookupRecipientEmail: RecipientEmailLookup;
}

/** Outcome of a single core for a single org. */
export interface AutomationResult {
  automation: AutomationKey;
  /** True iff this run won the period claim and did the work (vs. skipped). */
  ran: boolean;
  /** Notifications written + business rows changed by this core this run. */
  effects: number;
  emailsSent: number;
  emailsFailed: number;
}

/**
 * One core's outcome for one org as the tick reports it. `failed` means the core
 * threw: its counters are zero and its `ran` is false, so only this flag tells a
 * failure apart from a core that had nothing to do.
 */
export type OrgAutomationResult = { orgId: string; failed: boolean } & AutomationResult;

/**
 * What became of one org on a tick. `skipped`: no owner/admin to act as, or no
 * settings row. `failed`: reading its system actor threw, so no core ran.
 */
export type OrgRunOutcome =
  | { orgId: string; status: 'processed'; results: OrgAutomationResult[] }
  | { orgId: string; status: 'skipped' }
  | { orgId: string; status: 'failed' };

/** What the runner returns (and logs) for the whole tick. */
export interface AutomationRunSummary {
  ranAt: string;
  orgsTotal: number;
  orgsProcessed: number;
  orgsSkipped: number;
  orgsFailed: number;
  /** Cores that threw, across every processed org. */
  coreFailures: number;
  emailsSent: number;
  emailsFailed: number;
  durationMs: number;
  /** Ordered by org id, then by core in the runner's fixed order. */
  results: OrgAutomationResult[];
}
