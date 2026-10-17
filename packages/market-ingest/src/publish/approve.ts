// Publish re-runs the gate and publishes what it computed. This decides whether
// that output is what the owner approved: nothing blocks, every source file
// the bulletin names was hashed from disk, the history was checked, and the
// bytes hash to --approve. Nothing is written until all of it holds.
import { existsSync, readFileSync } from 'node:fs';
import type { CheckRun } from '../commands/perform-check';
import { FINDING_TITLES, isBlocking } from '../findings';
import type { StagedBulletin } from '../stage';
import { periodPaths } from '../staging';

const SHA256 = /^[0-9a-f]{64}$/;

export function requireApproveHash(approve: string | undefined): string {
  if (approve === undefined || !SHA256.test(approve)) {
    throw new Error('--approve takes the 64-character extraction_sha256 that market:review printed');
  }
  return approve;
}

/** Why the reviewed staged.json cannot be what publish computes, when it says so itself. */
function reviewedOffline(period: string): boolean {
  const path = periodPaths(period).staged;
  if (!existsSync(path)) return false;
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as Partial<StagedBulletin>).provenance?.historyChecked === false;
  } catch {
    return false;
  }
}

export function approvedStaged(run: CheckRun, period: string, approve: string): StagedBulletin {
  const staged = run.outcome.staged;
  const blocking = run.outcome.findings.filter(isBlocking);
  if (blocking.length > 0) {
    const lines = blocking.map(
      (item) => `  ${item.code} ${FINDING_TITLES[item.code]} page ${item.page ?? '-'} ${item.rowId ?? ''} ${item.month ? `month ${item.month} ` : ''}${item.message}`,
    );
    throw new Error(`the gate finds ${blocking.length} blocking finding(s); nothing was written:\n${lines.join('\n')}`);
  }
  const source = staged.source;
  if (source?.pdfSha256 && !staged.provenance.sourcesVerified.pdf) throw new Error('pass --pdf <the PDF>: publish verifies every source file the bulletin names');
  if (source?.mdSha256 && !staged.provenance.sourcesVerified.md) throw new Error('pass --md <the MD>: publish verifies every source file the bulletin names');
  if (run.stagedSha256 !== approve) {
    const offline = reviewedOffline(period) ? ' The staged.json on disk was checked with --offline, which publish never accepts.' : '';
    throw new Error(
      `the gate computes ${run.stagedSha256} for these files now, not the approved ${approve}.${offline} Something changed since the review (the files, the overrides, the published history or the gate commit), or the review did not pass the same --pdf/--md. Run market:review again, online and with --pdf/--md, and approve the hash it prints`,
    );
  }
  if (staged.items.length === 0) throw new Error('the bulletin carries no items; nothing to publish');
  return staged;
}
