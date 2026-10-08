import 'server-only';
import { runExpireProposals } from './expire-proposals';
import { runFollowupReminders } from './followup-reminders';
import { runHandoverCloser } from './handover-closer';
import { runPortfolioDigest } from './portfolio-digest';
import { runStageReminders } from './stage-reminders';
import type { AutomationDeps, AutomationKey, AutomationResult } from './types';

/**
 * Every automation core, in the order the runner works through them for each
 * org. Each core decides for itself whether this tick is its hour and whether it
 * already ran (its period claim); the order only fixes the log and the report.
 */
export const CORES: ReadonlyArray<{
  key: AutomationKey;
  run: (deps: AutomationDeps) => Promise<AutomationResult>;
}> = [
  { key: 'expire', run: runExpireProposals },
  { key: 'followup', run: runFollowupReminders },
  { key: 'digest', run: runPortfolioDigest },
  { key: 'stage', run: runStageReminders },
  { key: 'handover', run: runHandoverCloser },
];
