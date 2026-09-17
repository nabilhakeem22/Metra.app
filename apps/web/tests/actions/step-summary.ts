import { appendFileSync } from 'node:fs';

/**
 * GFM renders a pipe-delimited line as a TABLE only after a DELIMITER row, so a
 * lone `| a | b |` renders as a literal paragraph — which is what every run
 * produced, in the one place this was added for. The leading blank line matters
 * too: the *Migration batch size* step writes a plain sentence into the same
 * summary, and a table that starts on the line after a paragraph is not a table.
 */
const TABLE_HEADER = '\n| measurement | duration | budget | within budget |\n|---|---|---|---|';

/**
 * Written once per PROCESS, not once per run. Vitest gives each test file its
 * own worker, so two files recording a metric produce two small tables rather
 * than one — correct GFM either way, and cheaper than coordinating across
 * workers for a cosmetic join. There is one call site today.
 */
let tableStarted = false;

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
 * is printed for COMPARISON and NOTHING HERE EVER FAILS A TEST — which the
 * unguarded `appendFileSync` quietly contradicted: a read-only or vanished
 * summary path threw, out of a helper whose whole contract is that it cannot.
 * The console line is written FIRST and unconditionally, so the number survives
 * a summary that does not.
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
  try {
    appendFileSync(summaryPath, `${tableStarted ? '' : TABLE_HEADER}\n${row}\n`, 'utf8');
    // Set only after a SUCCESSFUL write: a failed first append must not leave
    // the next row orphaned under a header that was never written.
    tableStarted = true;
  } catch (error) {
    console.log(
      `step summary unavailable (${(error as Error).message}); the row above is ` +
        'the record. This helper never fails a test.',
    );
  }
}

/**
 * Test-only: forget that this process already wrote the header, so a case can
 * assert what a FIRST append looks like. No dbtest calls it.
 */
export function resetStepSummaryForTest(): void {
  tableStarted = false;
}
