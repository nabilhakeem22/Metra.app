// What a market write that waited 3 s for a lock (55P03) tells the owner about
// each session holding a market lock: who it is (its application_name; the
// CLI's own sessions say metra-market-cli), what it is doing, for how long,
// and whether to wait for it or end it. Pure: the read is ./lock-holders.ts.

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

/** A transaction open this long is past anything a market command or a studio seed takes. */
export const LEFT_BEHIND_AFTER_SECONDS = 60;

/**
 * Whether nothing will end this holder on its own. An `idle` session with no
 * transaction open can hold a lock only at SESSION level, which no market
 * command takes any more (a studio seed holds the book per transaction), so
 * it is a session left behind: an older CLI, or a SQL editor tab. No timeout
 * ends it. A transaction open past LEFT_BEHIND_AFTER_SECONDS is one a dropped
 * connection left open.
 */
export function isLeftBehind(holder: LockHolder): boolean {
  if (holder.transactionSeconds === null) return holder.state === 'idle';
  return holder.transactionSeconds >= LEFT_BEHIND_AFTER_SECONDS;
}

function seconds(value: number | null): string {
  return value === null ? '? s' : `${value} s`;
}

function holderLine(holder: LockHolder): string {
  const who = `pid ${holder.pid} (${holder.applicationName || 'no application name'})`;
  const doing = holder.transactionSeconds === null
    ? `${holder.state ?? 'unknown state'} for ${seconds(holder.stateSeconds)}, no transaction open`
    : `${holder.state ?? 'unknown state'}, transaction open ${seconds(holder.transactionSeconds)}`;
  return `  ${who}, ${doing}: ${isLeftBehind(holder) ? 'LEFT BEHIND, end it' : 'running, wait for it'}`;
}

export function lockHolderReport(holders: LockHolder[]): string {
  if (holders.length === 0) return 'No session holds a market lock now: run the command again.';
  return [
    'Another session holds the market locks:',
    ...holders.map(holderLine),
    'End a holder marked LEFT BEHIND in the SQL editor with: select pg_terminate_backend(<pid>);',
    'It is a session a dropped connection left behind (an idle one with no transaction open holds its lock until it is ended; no timeout ends it).',
    'A holder marked "running" is a publish, a withdrawal or a studio seed still at work: wait for it, then run the command again.',
  ].join('\n');
}
