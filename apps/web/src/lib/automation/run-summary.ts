// The tick's totals and its one log line. PURE: no server-only, no I/O.
import type {
  AutomationRunSummary,
  OrgAutomationResult,
  OrgRunOutcome,
} from './types';

function totalOf(
  results: readonly OrgAutomationResult[],
  field: 'emailsSent' | 'emailsFailed',
): number {
  return results.reduce((total, result) => total + result[field], 0);
}

/** Fold the per-org outcomes (already in org-id order) into the tick summary. */
export function summarizeTick(
  outcomes: readonly OrgRunOutcome[],
  ranAt: Date,
  durationMs: number,
): AutomationRunSummary {
  const results = outcomes.flatMap((outcome) =>
    outcome.status === 'processed' ? outcome.results : [],
  );
  const countOf = (status: OrgRunOutcome['status']) =>
    outcomes.filter((outcome) => outcome.status === status).length;
  return {
    ranAt: ranAt.toISOString(),
    orgsTotal: outcomes.length,
    orgsProcessed: countOf('processed'),
    orgsSkipped: countOf('skipped'),
    orgsFailed: countOf('failed'),
    coreFailures: results.filter((result) => result.failed).length,
    emailsSent: totalOf(results, 'emailsSent'),
    emailsFailed: totalOf(results, 'emailsFailed'),
    durationMs,
    results,
  };
}

/**
 * The single line a tick writes. Counts only: no org id, no address, no name,
 * so it is safe for any log sink and greppable as `automation tick:`.
 */
export function tickLogLine(summary: AutomationRunSummary): string {
  return (
    `automation tick: orgs=${summary.orgsTotal} processed=${summary.orgsProcessed}` +
    ` skipped=${summary.orgsSkipped} failed=${summary.orgsFailed}` +
    ` coreFailures=${summary.coreFailures} emailsSent=${summary.emailsSent}` +
    ` emailsFailed=${summary.emailsFailed} durationMs=${summary.durationMs}`
  );
}
