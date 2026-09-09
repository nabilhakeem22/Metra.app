// The build-cost range's history, derived from the engagement ledger. PURE and
// CLIENT-SAFE (the `inline-dropzone-category.ts` pattern): no db, no server-only,
// so the Budget tab renders it and a unit test reads it without a React tree.
//
// TWO KINDS, ONE STORY. `rom_range_set` is the firm issuing or revising the band;
// `rom_acknowledgement` is the client confirming they have seen one. They share
// the reserved `range_low`/`range_high` columns and interleave by date into the
// sequence a studio actually needs to read back: set, revised, revised,
// acknowledged.
//
// Rows missing either bound are DROPPED rather than rendered as a half-range. The
// acknowledgement path cannot produce one (it fails `rom_not_set` first) and the
// set path validates both bounds, so a partial row means data that predates or
// bypassed both — and a range with one end missing is not a range.
import type { EngagementEventRecord } from './queries';

/** One band the firm put in front of the client, or the client confirmed. */
export interface RomHistoryEntry {
  id: string;
  kind: 'rom_range_set' | 'rom_acknowledgement';
  at: Date;
  low: string;
  high: string;
  /** Insert order — the tie-break, never rendered. */
  seq: Date;
}

const ROM_KINDS = new Set(['rom_range_set', 'rom_acknowledgement']);

/**
 * A TOTAL order, newest first: `decidedAt`, then `createdAt`, then `id`.
 *
 * `decidedAt` alone is not enough. postgres.js truncates `timestamptz` to
 * millisecond precision, so two events can tie, and a tie resolved by nothing but
 * sort stability is a claim about the caller's ordering that this module's whole
 * point is not to make. `guards/readiness.ts` already settled this exact order for
 * this exact table.
 */
function newestFirst(a: RomHistoryEntry, b: RomHistoryEntry): number {
  const decided = b.at.getTime() - a.at.getTime();
  if (decided !== 0) return decided;
  const created = b.seq.getTime() - a.seq.getTime();
  if (created !== 0) return created;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/**
 * Every recorded band, newest first. Sorted here rather than trusting the
 * caller's ordering: the Budget tab reads the same event array the Timeline does,
 * and the two want different orders.
 */
export function romHistory(events: EngagementEventRecord[]): RomHistoryEntry[] {
  return events
    .filter(
      (e): e is EngagementEventRecord & { rangeLow: string; rangeHigh: string } =>
        ROM_KINDS.has(e.kind) && e.rangeLow !== null && e.rangeHigh !== null,
    )
    .map((e) => ({
      id: e.id,
      kind: e.kind as RomHistoryEntry['kind'],
      at: e.decidedAt,
      low: e.rangeLow,
      high: e.rangeHigh,
      seq: e.createdAt,
    }))
    .sort(newestFirst);
}
