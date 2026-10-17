// The gate's own integrity: review and publish run only from a checkout whose
// gate code (packages/market-ingest and packages/db/src) is exactly a commit,
// and that commit is recorded in staged.json and on the published bulletin.
// An extracting session works in the same checkout and could otherwise relax a
// validator; this makes such an edit refuse to review or publish.
import { execFileSync } from 'node:child_process';
import { repoRoot } from './staging';

export interface GateState {
  /** `git rev-parse HEAD`, or null when git cannot answer. */
  commit: string | null;
  /** Gate files that differ from that commit (modified, staged or untracked). */
  changedFiles: string[];
}

const GATE_PATHS = ['packages/market-ingest', 'packages/db/src'];

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

export function readGate(): GateState {
  try {
    const commit = git(['rev-parse', 'HEAD']).trim();
    const status = git(['status', '--porcelain', '--untracked-files=all', '--', ...GATE_PATHS]);
    return { commit, changedFiles: status.split('\n').filter((line) => line.trim() !== '').map((line) => line.slice(3)) };
  } catch {
    return { commit: null, changedFiles: [] };
  }
}

/** The clean gate's commit, or a refusal naming what differs. */
export function requireCleanGate(state: GateState, step: string): string {
  if (state.commit === null || !/^[0-9a-f]{40}$/.test(state.commit)) {
    throw new Error(`${step} runs only from a git checkout (git rev-parse HEAD did not answer)`);
  }
  if (state.changedFiles.length > 0) {
    const listed = state.changedFiles.slice(0, 10).join(', ');
    throw new Error(`${step} refuses: the gate code differs from commit ${state.commit.slice(0, 12)} (${listed}${state.changedFiles.length > 10 ? ', ...' : ''}). Restore it (git status) and run again`);
  }
  return state.commit;
}
