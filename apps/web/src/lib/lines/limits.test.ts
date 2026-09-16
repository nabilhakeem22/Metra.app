import { describe, expect, it } from 'vitest';
import {
  LINE_INSERT_CHUNK,
  MAX_LINES_PER_SECTION,
  MAX_SECTIONS,
  MAX_TOTAL_LINES,
} from './limits';

// This file began as lib/proposals/validation.test.ts. Its money assertions moved
// to money/read.test.ts, its percentage assertions to validation/percent.test.ts,
// its date assertions to validation/iso-date.test.ts, its trim assertions to
// validation/text.test.ts, and the `chunk` assertions became the batch-boundary
// cases in ./insert-chunked.test.ts when `chunk` was superseded. What is left is
// what this module actually owns: the numbers.

describe('the line caps', () => {
  it('pins the numbers the builder guard and the server core must agree on', () => {
    // Four modules (proposals, contracts, variations, boqs) enforce these. They
    // are pinned here rather than in each module so a change is one visible diff
    // instead of four that can drift apart.
    expect(MAX_SECTIONS).toBe(100);
    expect(MAX_LINES_PER_SECTION).toBe(500);
    expect(MAX_TOTAL_LINES).toBe(2000);
  });

  it('keeps the insert batch clear of the bind-parameter ceiling', () => {
    // A line row carries ~15 columns; Postgres refuses past 65,535 parameters.
    expect(LINE_INSERT_CHUNK).toBe(500);
    expect(LINE_INSERT_CHUNK * 15).toBeLessThan(65_535);
  });

  it('allows a document that fills every section without hitting the total', () => {
    // MAX_TOTAL_LINES is the binding constraint, not MAX_SECTIONS x MAX_LINES:
    // the per-section cap alone would permit 50,000 lines.
    expect(MAX_SECTIONS * MAX_LINES_PER_SECTION).toBeGreaterThan(MAX_TOTAL_LINES);
  });
});
