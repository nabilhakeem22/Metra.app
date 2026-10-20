import { describe, expect, it } from 'vitest';
import { APPLY_ATTEMPTS, RETRY_PAUSES_MS, applyFileWithRetry, type RetryDeps } from './apply-rls-retry';

// B4 reliability R1: apply-rls B deadlocked (40P01) against ordinary sub-second
// app traffic at policies/00-core.sql, and lost lock waits (55P03) to long
// readers. A file is one implicit transaction and idempotent, so the script
// tries the SAME file again, a bounded number of times, and only for those two
// SQLSTATEs. Errors are shaped as postgres.js throws them (the code on the
// error) and as drizzle wraps them (the code on `cause`).

function driverError(code: string): Error {
  return Object.assign(new Error(`server said ${code}`), { code });
}

function wrapped(code: string): Error {
  return Object.assign(new Error('Failed query: ...'), { cause: driverError(code) });
}

function recorder(): RetryDeps & { lines: string[]; pauses: number[] } {
  const lines: string[] = [];
  const pauses: number[] = [];
  return {
    lines,
    pauses,
    log: (line) => lines.push(line),
    sleep: (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
  };
}

/** A file run that fails with these errors in turn, then lands. */
function failingThen(errors: Error[]): { run: () => Promise<unknown>; calls: () => number } {
  let calls = 0;
  return {
    run: () => {
      const error = errors[calls];
      calls += 1;
      return error ? Promise.reject(error) : Promise.resolve([]);
    },
    calls: () => calls,
  };
}

describe('applyFileWithRetry', () => {
  it('runs a file once when it lands, and says nothing more', async () => {
    const deps = recorder();
    const file = failingThen([]);
    await applyFileWithRetry('policies/00-core.sql', file.run, deps);
    expect(file.calls()).toBe(1);
    expect(deps.lines).toEqual([]);
  });

  it.each(['40P01', '55P03'])('tries a file again after %s and prints which attempt', async (code) => {
    const deps = recorder();
    const file = failingThen([driverError(code)]);
    await applyFileWithRetry('policies/00-core.sql', file.run, deps);
    expect(file.calls()).toBe(2);
    expect(deps.pauses).toEqual([RETRY_PAUSES_MS[0]]);
    expect(deps.lines).toEqual([
      `apply-rls: policies/00-core.sql rolled back with SQLSTATE ${code} on attempt 1 of 3 (a lock race with live traffic); trying it again in 2 s.`,
      'Applying policies/00-core.sql ... (attempt 2 of 3)',
    ]);
  });

  it('reads the SQLSTATE through a drizzle-style wrapper', async () => {
    const deps = recorder();
    const file = failingThen([wrapped('40P01'), wrapped('55P03')]);
    await applyFileWithRetry('policies/40-engagements.sql', file.run, deps);
    expect(file.calls()).toBe(3);
    expect(deps.pauses).toEqual([...RETRY_PAUSES_MS]);
    expect(deps.lines.at(-1)).toBe('Applying policies/40-engagements.sql ... (attempt 3 of 3)');
  });

  it(`gives up after ${String(APPLY_ATTEMPTS)} attempts and throws the LAST failure as it came`, async () => {
    const deps = recorder();
    const last = driverError('40P01');
    const file = failingThen([driverError('40P01'), driverError('55P03'), last]);
    await expect(applyFileWithRetry('policies/00-core.sql', file.run, deps)).rejects.toBe(last);
    expect(file.calls()).toBe(APPLY_ATTEMPTS);
    expect(deps.pauses).toHaveLength(APPLY_ATTEMPTS - 1);
  });

  it.each(['23514', '42703', '42501', 'CONNECTION_CLOSED'])('never retries %s: it fails on the first attempt', async (code) => {
    const deps = recorder();
    const error = driverError(code);
    const file = failingThen([error]);
    await expect(applyFileWithRetry('roles.sql', file.run, deps)).rejects.toBe(error);
    expect(file.calls()).toBe(1);
    expect(deps.lines).toEqual([]);
  });

  it('never retries an error with no SQLSTATE', async () => {
    const error = new Error('ENOENT: no such file');
    const file = failingThen([error]);
    await expect(applyFileWithRetry('roles.sql', file.run, recorder())).rejects.toBe(error);
    expect(file.calls()).toBe(1);
  });
});
