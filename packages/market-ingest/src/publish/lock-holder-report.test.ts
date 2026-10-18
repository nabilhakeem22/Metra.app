import { describe, expect, it } from 'vitest';
import { LEFT_BEHIND_IDLE_SECONDS, isLeftBehind, lockHolderReport, type LockHolder } from './lock-holder-report';

// An idle session holding a market lock with no transaction open used to
// print "transaction open ? s" and advice that named only a stuck publish, so
// a seed left behind by a dropped link read as something to wait for. And a
// verdict on transaction AGE told the owner to kill a healthy publish past
// 60 s, which may run 300 s (overnight round, R1).

const holder = (overrides: Partial<LockHolder>): LockHolder => ({
  pid: 34300,
  applicationName: 'metra-market-cli',
  state: 'active',
  transactionSeconds: 2,
  stateSeconds: 1,
  ...overrides,
});

describe('the lock holder report', () => {
  it('names an idle session with no transaction, its application and its idle age, as one to end', () => {
    const report = lockHolderReport([holder({ state: 'idle', transactionSeconds: null, stateSeconds: 98 })]);
    expect(report).toContain('pid 34300 (metra-market-cli), idle for 98 s, no transaction open: LEFT BEHIND, end it');
    expect(report).toContain('select pg_terminate_backend(<pid>);');
    expect(report).toMatch(/no timeout ends it/);
  });

  it('calls a publish running one long statement "running", however old its transaction', () => {
    const report = lockHolderReport([holder({ state: 'active', transactionSeconds: 68, stateSeconds: 68 })]);
    expect(report).toContain('pid 34300 (metra-market-cli), active for 68 s, transaction open 68 s: running, wait for it');
    expect(isLeftBehind(holder({ state: 'active', transactionSeconds: 299, stateSeconds: 299 }))).toBe(false);
  });

  it('calls a slow-link publish with short gaps between statements "running", however old its transaction', () => {
    const report = lockHolderReport([holder({ state: 'idle in transaction', transactionSeconds: 68, stateSeconds: 1 })]);
    expect(report).toContain('pid 34300 (metra-market-cli), idle in transaction for 1 s, transaction open 68 s: running, wait for it');
    expect(report).toMatch(/a publish, a withdrawal or a studio seed still at work: wait for it/);
  });

  it('marks a transaction idle past the longest idle timeout as left behind, and one at it as running', () => {
    const idle = (stateSeconds: number, state = 'idle in transaction') => holder({ state, transactionSeconds: stateSeconds + 5, stateSeconds });
    expect(LEFT_BEHIND_IDLE_SECONDS).toBe(60);
    expect(isLeftBehind(idle(LEFT_BEHIND_IDLE_SECONDS + 1))).toBe(true);
    expect(isLeftBehind(idle(LEFT_BEHIND_IDLE_SECONDS + 1, 'idle in transaction (aborted)'))).toBe(true);
    expect(isLeftBehind(idle(LEFT_BEHIND_IDLE_SECONDS))).toBe(false);
  });

  it('says so when a session has no application name or a missing age, and never says end it on no evidence', () => {
    const report = lockHolderReport([holder({ applicationName: '', state: null, transactionSeconds: null, stateSeconds: null })]);
    expect(report).toContain('pid 34300 (no application name), unknown state for ? s, no transaction open: running, wait for it');
    expect(isLeftBehind(holder({ state: 'idle in transaction', stateSeconds: null }))).toBe(false);
  });

  it('says to run again when nobody holds a market lock', () => {
    expect(lockHolderReport([])).toBe('No session holds a market lock now: run the command again.');
  });
});
