// The IO around the pure check: read the producer's files and the owner's
// overrides, load the published history (none with --offline), run the check,
// write check.json and staged.json. `market:check` and `market:review` share
// it, and `market:publish` re-runs `computeCheck` inside its transaction, so
// what is published is what the gate computed, never a file's parsed JSON.
import { EMPTY_HISTORY, type PublishedHistory } from '../check/context';
import { HISTORY_VALIDATORS } from '../check/history';
import { runCheck, type CheckOutcome } from '../check/run';
import { withDatabase } from '../db/connection';
import { FINDING_TITLES, isBlocking } from '../findings';
import { readGate } from '../gate';
import { loadHistory } from '../history/load';
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
  stagedBytes: string;
  stagedSha256: string;
  warnings: string[];
}

/** One check over the files on disk, against `history` (null = offline). */
export function computeCheck(options: CheckRunOptions, history: PublishedHistory | null, gateCommit: string | null): CheckRun {
  const paths = periodPaths(options.period);
  const warnings: string[] = [];
  if (options.pdfPath === undefined) warnings.push('the PDF hash was not verified (pass --pdf <path>)');
  if (options.mdPath === undefined) warnings.push('the MD hash was not verified (pass --md <path>)');
  if (history === null) warnings.push('offline: B6, B7, B11, F2 and F3 did not run, F1/F4 saw no published history, and publish refuses this staged.json');
  const outcome = runCheck({
    period: options.period,
    producerFiles: readProducerFiles(paths),
    mapping: readOptionalJson(paths.mapping, undefined),
    corrections: readOptionalJson(paths.corrections, undefined),
    history: history ?? EMPTY_HISTORY,
    historyValidators: history === null ? [] : HISTORY_VALIDATORS,
    flagPct: flagPctFromEnv(),
    sourceHashes: {
      pdf: options.pdfPath === undefined ? null : sha256OfFile(options.pdfPath),
      md: options.mdPath === undefined ? null : sha256OfFile(options.mdPath),
    },
    gateCommit,
  });
  const stagedBytes = jsonBytes(outcome.staged);
  return { outcome, history: history ?? EMPTY_HISTORY, stagedBytes, stagedSha256: sha256Hex(stagedBytes), warnings };
}

export async function performCheck(options: CheckRunOptions): Promise<CheckRun> {
  const history = options.offline ? null : await withDatabase((sql) => loadHistory(sql, options.period));
  const run = computeCheck(options, history, readGate().commit);
  const paths = periodPaths(options.period);
  const { findings } = run.outcome;
  const counts = Object.fromEntries(Object.keys(FINDING_TITLES).map((code) => [code, findings.filter((item) => item.code === code).length]));
  writeText(paths.check, jsonBytes({ format: 'metra.market-check.v1', period: options.period, offline: options.offline, counts, findings }));
  writeText(paths.staged, run.stagedBytes);
  return run;
}

export function blockingCount(run: CheckRun): number {
  return run.outcome.findings.filter(isBlocking).length;
}
