// The IO around the pure check: read the producer's files and the owner's
// overrides, load the published history (none with --offline), run the check,
// write check.json and staged.json. `market:check` and `market:review` share it,
// so a review is always of exactly what was just checked.
import { EMPTY_HISTORY, type PublishedHistory } from '../check/context';
import { HISTORY_VALIDATORS } from '../check/history';
import { withDatabase } from '../db/connection';
import { loadHistory } from '../history/load';
import { runCheck, type CheckOutcome } from '../check/run';
import { FINDING_TITLES, isBlocking } from '../findings';
import { jsonBytes, periodPaths, readOptionalJson, readProducerFiles, sha256Hex, sha256OfFile, writeText } from '../staging';
import { flagPctFromEnv } from './options';

export interface CheckRunOptions {
  period: string;
  offline: boolean;
  mdPath: string | undefined;
  pdfPath: string | undefined;
}

export interface CheckRun {
  outcome: CheckOutcome;
  history: PublishedHistory;
  stagedSha256: string;
  warnings: string[];
}

export async function performCheck(options: CheckRunOptions): Promise<CheckRun> {
  const paths = periodPaths(options.period);
  const warnings: string[] = [];
  if (options.pdfPath === undefined) warnings.push('the PDF hash was not verified (pass --pdf <path>)');
  if (options.mdPath === undefined) warnings.push('the MD hash was not verified (pass --md <path>)');
  const history = options.offline ? EMPTY_HISTORY : await withDatabase((sql) => loadHistory(sql, options.period));
  const outcome = runCheck({
    period: options.period,
    producerFiles: readProducerFiles(paths),
    mapping: readOptionalJson(paths.mapping, undefined),
    corrections: readOptionalJson(paths.corrections, undefined),
    history,
    historyValidators: options.offline ? [] : HISTORY_VALIDATORS,
    flagPct: flagPctFromEnv(),
    sourceHashes: {
      pdf: options.pdfPath === undefined ? null : sha256OfFile(options.pdfPath),
      md: options.mdPath === undefined ? null : sha256OfFile(options.mdPath),
    },
  });
  if (options.offline) warnings.push('offline: B6, B7, B11, F2 and F3 did not run, and F1/F4 saw no published history');
  const counts = Object.fromEntries(
    Object.keys(FINDING_TITLES).map((code) => [code, outcome.findings.filter((item) => item.code === code).length]),
  );
  writeText(paths.check, jsonBytes({ format: 'metra.market-check.v1', period: options.period, offline: options.offline, counts, findings: outcome.findings }));
  const stagedBytes = jsonBytes(outcome.staged);
  writeText(paths.staged, stagedBytes);
  return { outcome, history, stagedSha256: sha256Hex(stagedBytes), warnings };
}

export function blockingCount(run: CheckRun): number {
  return run.outcome.findings.filter(isBlocking).length;
}
