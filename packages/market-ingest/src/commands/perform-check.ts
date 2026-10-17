// The IO around the pure check: read the producer's files and the owner's
// overrides, load the published history (none with --offline), run the check,
// write check.json and staged.json. `market:check` and `market:review` share it,
// so a review is always of exactly what was just checked.
import { EMPTY_HISTORY } from '../check/context';
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
  stagedSha256: string;
  warnings: string[];
}

export async function performCheck(options: CheckRunOptions): Promise<CheckRun> {
  const paths = periodPaths(options.period);
  const warnings: string[] = [];
  if (options.pdfPath === undefined) warnings.push('the PDF hash was not verified (pass --pdf <path>)');
  if (options.mdPath === undefined) warnings.push('the MD hash was not verified (pass --md <path>)');
  if (!options.offline) {
    throw new Error('the database-backed checks are not available yet; run with --offline');
  }
  const outcome = runCheck({
    period: options.period,
    producerFiles: readProducerFiles(paths),
    mapping: readOptionalJson(paths.mapping, undefined),
    corrections: readOptionalJson(paths.corrections, undefined),
    history: EMPTY_HISTORY,
    historyValidators: [],
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
  return { outcome, stagedSha256: sha256Hex(stagedBytes), warnings };
}

export function blockingCount(run: CheckRun): number {
  return run.outcome.findings.filter(isBlocking).length;
}
