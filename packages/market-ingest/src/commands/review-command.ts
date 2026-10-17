// `npm run market:review -- --period 2026-07 [--offline] [--pdf <path>] [--md <path>]`
// Re-runs the check (so the review is of exactly what was just checked), writes
// review.html and prints extraction_sha256 = sha256(staged.json), the hash the
// owner approves.
import { parseArgs } from 'node:util';
import { renderReview } from '../review/html';
import { periodPaths, writeText } from '../staging';
import { requirePeriod } from './options';
import { blockingCount, performCheck } from './perform-check';

export async function reviewCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { period: { type: 'string' }, offline: { type: 'boolean' }, md: { type: 'string' }, pdf: { type: 'string' } },
    strict: true,
  });
  const period = requirePeriod(values.period);
  const offline = values.offline === true;
  const run = await performCheck({ period, offline, mdPath: values.md, pdfPath: values.pdf });
  const { findings, context } = run.outcome;
  const path = periodPaths(period).review;
  writeText(path, renderReview({ period, findings, context, stagedSha256: run.stagedSha256, history: run.history, offline }));
  for (const warning of run.warnings) console.log(`warning: ${warning}`);
  console.log(`wrote ${path}`);
  console.log(`extraction_sha256 = ${run.stagedSha256}`);
  const blocking = blockingCount(run);
  if (blocking > 0) console.log(`BLOCKED: ${blocking} blocking finding(s); market:publish will refuse this staged.json`);
  return 0;
}
