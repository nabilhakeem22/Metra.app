import { appendFileSync } from 'node:fs';

/**
 * Append one duration row to the GitHub Actions run summary. A no-op off CI.
 *
 * THE POINT IS A TREND A HUMAN CAN SCAN ACROSS RUNS, NOT AN ASSERTION. The
 * 2,000-line save used to carry a wall-clock `expect`, which was deleted in wave
 * 4 because it was a pin on a shared runner's speed. That left the save with no
 * time signal at all: the only remaining bound is the 20 s `statement_timeout`,
 * so a 2 s -> 19 s regression is invisible and still green.
 *
 * The honest instrument for that is a NUMBER PRINTED WHERE SOMEONE WILL SEE IT.
 * A threshold loose enough to be fair on a shared runner proves nothing, and one
 * tight enough to mean something goes red on an unlucky Tuesday. So `budgetMs`
 * is printed for COMPARISON and nothing here ever fails a test.
 */
export function recordDurationMetric(
  name: string,
  ms: number,
  budgetMs: number,
): void {
  const row = `| ${name} | ${ms} ms | ${budgetMs} ms | ${ms <= budgetMs ? 'ok' : 'OVER'} |`;
  // Always logged, so the number is in the job log even when the summary file
  // is not there (a local run, or a runner that stops setting the variable).
  console.log(row);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  appendFileSync(summaryPath, `${row}\n`, 'utf8');
}
