import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordDurationMetric, resetStepSummaryForTest } from './step-summary';

// R10, both halves.
//
//   (a) `| name | 2100 ms | 12000 ms | ok |` with no delimiter row renders as a
//       literal paragraph. GFM needs `|---|` before it is a table, and the
//       helper was only ever added FOR the summary.
//   (b) `appendFileSync` was unguarded, in a helper whose docstring says
//       "nothing here ever fails a test". A read-only or vanished summary path
//       threw and reddened the dbtest that called it.
//
// No database: this is the unit config, and `*.dbtest.ts` is not in it.

let summaryDir: string;
let summaryPath: string;
const logged: string[] = [];

beforeEach(() => {
  summaryDir = mkdtempSync(join(tmpdir(), 'metra-step-summary-'));
  summaryPath = join(summaryDir, 'summary.md');
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
  resetStepSummaryForTest();
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    logged.push(parts.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  logged.length = 0;
  delete process.env.GITHUB_STEP_SUMMARY;
  rmSync(summaryDir, { recursive: true, force: true });
});

function summary(): string {
  return readFileSync(summaryPath, 'utf8');
}

describe('recordDurationMetric', () => {
  it('writes a header and a delimiter row before the first data row', () => {
    recordDurationMetric('2,000-line proposal save', 2100, 12000);
    expect(summary()).toBe(
      '\n| measurement | duration | budget | within budget |\n' +
        '|---|---|---|---|\n' +
        '| 2,000-line proposal save | 2100 ms | 12000 ms | ok |\n',
    );
  });

  it('writes the header ONCE, however many rows follow', () => {
    recordDurationMetric('first', 1, 10);
    recordDurationMetric('second', 2, 10);
    recordDurationMetric('third', 30, 10);
    const lines = summary().split('\n').filter(Boolean);
    expect(lines.filter((line) => line.startsWith('|---|'))).toHaveLength(1);
    expect(lines).toEqual([
      '| measurement | duration | budget | within budget |',
      '|---|---|---|---|',
      '| first | 1 ms | 10 ms | ok |',
      '| second | 2 ms | 10 ms | ok |',
      '| third | 30 ms | 10 ms | OVER |',
    ]);
  });

  it('starts with a blank line, so a preceding paragraph cannot swallow the table', () => {
    // The "Migration batch size" step writes `pending migrations: N / 4` into
    // this same file, and a table that begins on the line after a paragraph is
    // not a table.
    recordDurationMetric('after a paragraph', 5, 10);
    expect(summary().startsWith('\n|')).toBe(true);
  });

  it('never throws when the summary path cannot be written, and still logs the row', () => {
    // A directory is not a file: appendFileSync raises EISDIR here on every
    // platform, which is the same shape as a read-only or vanished path.
    process.env.GITHUB_STEP_SUMMARY = summaryDir;
    expect(() => recordDurationMetric('unwritable', 7, 10)).not.toThrow();
    expect(logged[0]).toBe('| unwritable | 7 ms | 10 ms | ok |');
    expect(logged[1]).toContain('step summary unavailable');
    expect(logged[1]).toContain('never fails a test');
  });

  it('a failed FIRST append does not orphan the next row under a missing header', () => {
    process.env.GITHUB_STEP_SUMMARY = summaryDir;
    recordDurationMetric('lost', 1, 10);
    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    recordDurationMetric('kept', 2, 10);
    expect(summary()).toContain('|---|---|---|---|');
  });

  it('is a no-op off CI, and the number is still in the log', () => {
    delete process.env.GITHUB_STEP_SUMMARY;
    expect(() => recordDurationMetric('local run', 3, 10)).not.toThrow();
    expect(logged).toEqual(['| local run | 3 ms | 10 ms | ok |']);
  });

  it('renders a non-finite duration without throwing', () => {
    // Nothing asserts on the clock, which is the point - but a NaN must not be
    // the thing that reds the suite either.
    recordDurationMetric('nan', Number.NaN, 10);
    recordDurationMetric('infinite', Number.POSITIVE_INFINITY, 10);
    expect(summary()).toContain('| nan | NaN ms | 10 ms | OVER |');
    expect(summary()).toContain('| infinite | Infinity ms | 10 ms | OVER |');
  });
});
