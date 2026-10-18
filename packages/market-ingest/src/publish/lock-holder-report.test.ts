import { describe, expect, it } from 'vitest';
import { LEFT_BEHIND_AFTER_SECONDS, isLeftBehind, lockHolderReport, type LockHolder } from './lock-holder-report';

// R1: an idle session holding a market lock with no transaction open used to
// print "transaction open ? s" and advice that named only a stuck publish,
// so a seed left behind by a dropped link read as something to wait for.

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

  it('tells the owner to wait for a transaction that is still at work', () => {
    const report = lockHolderReport([holder({ state: 'idle in transaction', transactionSeconds: 4 })]);
    expect(report).toContain('pid 34300 (metra-market-cli), idle in transaction, transaction open 4 s: running, wait for it');
    expect(report).toMatch(/a publish, a withdrawal or a studio seed still at work: wait for it/);
  });

  it('marks a transaction open past the bound as left behind, and one just under it as running', () => {
    expect(isLeftBehind(holder({ transactionSeconds: LEFT_BEHIND_AFTER_SECONDS }))).toBe(true);
    expect(isLeftBehind(holder({ transactionSeconds: LEFT_BEHIND_AFTER_SECONDS - 1 }))).toBe(false);
    // Active with no transaction is a statement on its way: never "end it" on its own.
    expect(isLeftBehind(holder({ state: 'active', transactionSeconds: null }))).toBe(false);
  });

  it('says so when a session has no application name or a missing age', () => {
    const report = lockHolderReport([holder({ applicationName: '', state: null, transactionSeconds: null, stateSeconds: null })]);
    expect(report).toContain('pid 34300 (no application name), unknown state for ? s, no transaction open: running, wait for it');
  });

  it('says to run again when nobody holds a market lock', () => {
    expect(lockHolderReport([])).toBe('No session holds a market lock now: run the command again.');
  });
});
