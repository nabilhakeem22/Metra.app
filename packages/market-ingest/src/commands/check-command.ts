// `npm run market:check -- --period 2026-07 [--offline] [--pdf <path>] [--md <path>]`
// Exit 1 while any blocking finding remains; check.json and staged.json are
// written either way.
import { parseArgs } from 'node:util';
import { FINDING_TITLES, isBlocking, type FindingCode } from '../findings';
import { periodPaths } from '../staging';
import { requirePeriod } from './options';
import { blockingCount, performCheck, type CheckRun } from './perform-check';

const LISTED_BLOCKING = 40;

export function printSummary(run: CheckRun, period: string): void {
  const { findings, context } = run.outcome;
  for (const warning of run.warnings) console.log(`warning: ${warning}`);
  if (context !== null) {
    const confidence = (value: string) => context.rows.filter((resolved) => resolved.row.confidence === value).length;
    console.log(`pages ${context.file.pages.length}, skipped ${context.file.skippedPages.length}, rows ${context.rows.length} (read ${confidence('read')}, inferred ${confidence('inferred')}, unreadable ${confidence('unreadable')})`);
  }
  for (const code of Object.keys(FINDING_TITLES) as FindingCode[]) {
    const count = findings.filter((item) => item.code === code).length;
    if (count > 0) console.log(`${code.padEnd(4)}${FINDING_TITLES[code].padEnd(22)}${count}`);
  }
  const blocking = findings.filter(isBlocking);
  for (const item of blocking.slice(0, LISTED_BLOCKING)) {
    console.log(`  ${item.code} page ${item.page ?? '-'} ${item.rowId ?? ''} ${item.month ? `month ${item.month} ` : ''}${item.message}`);
  }
  if (blocking.length > LISTED_BLOCKING) console.log(`  ... ${blocking.length - LISTED_BLOCKING} more in check.json`);
  const paths = periodPaths(period);
  console.log(`wrote ${paths.check}`);
  console.log(`wrote ${paths.staged} (sha256 ${run.stagedSha256})`);
}

export async function checkCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { period: { type: 'string' }, offline: { type: 'boolean' }, md: { type: 'string' }, pdf: { type: 'string' } },
    strict: true,
  });
  const period = requirePeriod(values.period);
  const run = await performCheck({ period, offline: values.offline === true, mdPath: values.md, pdfPath: values.pdf });
  printSummary(run, period);
  const blocking = blockingCount(run);
  console.log(blocking === 0 ? 'market:check passed: nothing blocks' : `market:check: ${blocking} blocking finding(s); publish refuses until they are resolved`);
  return blocking === 0 ? 0 : 1;
}
