// What a market write that waited 3 s for a lock (55P03) tells the owner about
// each session holding a market lock: who it is (its application_name; the
// CLI's own sessions say metra-market-cli), what it is doing, for how long,
// and whether to wait for it or end it. Pure: the read is ./lock-holders.ts.
import { MARKET_WRITE_IDLE_IN_TRANSACTION_MS } from '@metra/db/lock-timeout';

export interface LockHolder {
  pid: number;
  applicationName: string | null;
  /** pg_stat_activity.state: active, idle, idle in transaction, ... */
  state: string | null;
  /** Since its transaction began; null when no transaction is open. */
  transactionSeconds: number | null;
  /** Since it entered its current state. */
  stateSeconds: number | null;
}

/**
 * Past this, a transaction idle in its current state is one nothing ends: the
 * longest idle-in-transaction timeout a market lock holder runs under (a
 * publish or withdraw, 60 s; a studio seed's transaction, the app's and the
 * CLI's alike, 30 s). A holder still there past it runs without that timeout:
 * a SQL editor tab, say.
 */
export const LEFT_BEHIND_IDLE_SECONDS = MARKET_WRITE_IDLE_IN_TRANSACTION_MS / 1000;

const IDLE_IN_TRANSACTION = new Set(['idle in transaction', 'idle in transaction (aborted)']);

/**
 * Whether nothing will end this holder on its own. NEVER one running a
 * statement (`active`): a publish may run 300 s. An `idle` session (no
 * transaction open) can hold a lock only at SESSION level, which no market
 * command takes any more (a studio seed holds the book per transaction), so
 * it is a session left behind, and no timeout ends it. A transaction counts
 * by its time IDLE in its current state, never its age: a healthy publish over
 * a slow link spends most of its life idle in transaction between statements.
 */
export function isLeftBehind(holder: LockHolder): boolean {
  if (holder.state === 'idle') return true;
  if (holder.state !== null && IDLE_IN_TRANSACTION.has(holder.state)) return (holder.stateSeconds ?? 0) > LEFT_BEHIND_IDLE_SECONDS;
  return false;
}

function seconds(value: number | null): string {
  return value === null ? '? s' : `${value} s`;
}

function holderLine(holder: LockHolder): string {
  const who = `pid ${holder.pid} (${holder.applicationName || 'no application name'})`;
  const doing = holder.transactionSeconds === null
    ? `${holder.state ?? 'unknown state'} for ${seconds(holder.stateSeconds)}, no transaction open`
    : `${holder.state ?? 'unknown state'} for ${seconds(holder.stateSeconds)}, transaction open ${seconds(holder.transactionSeconds)}`;
  return `  ${who}, ${doing}: ${isLeftBehind(holder) ? 'LEFT BEHIND, end it' : 'running, wait for it'}`;
}

export function lockHolderReport(holders: LockHolder[]): string {
  if (holders.length === 0) return 'No session holds a market lock now: run the command again.';
  return [
    'Another session holds the market locks:',
    ...holders.map(holderLine),
    'End a holder marked LEFT BEHIND in the SQL editor with: select pg_terminate_backend(<pid>);',
    `It is a session left behind: idle with no transaction open (it holds its lock until it is ended; no timeout ends it), or idle in a transaction for more than ${LEFT_BEHIND_IDLE_SECONDS} s.`,
    'A holder marked "running" is a publish, a withdrawal or a studio seed still at work: wait for it, then run the command again.',
  ].join('\n');
}
