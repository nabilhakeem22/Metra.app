import type { AutomationSettings } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';

/** One of the four automation cores. */
export type AutomationKey = 'expire' | 'followup' | 'digest' | 'stage';

/**
 * Everything a core needs, resolved once per org by the runner: the system-actor
 * OrgContext (owner), that org's settings row, the run instant, the org's default
 * locale (for email copy), and the absolute app origin (for links).
 */
export interface AutomationDeps {
  ctx: OrgContext;
  settings: AutomationSettings;
  now: Date;
  locale: string;
  appUrl: string;
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

/** What the runner returns for the whole tick. */
export interface AutomationRunSummary {
  ranAt: string;
  orgsProcessed: number;
  results: Array<{ orgId: string } & AutomationResult>;
}
