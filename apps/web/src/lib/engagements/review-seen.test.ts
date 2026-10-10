import { describe, expect, it } from 'vitest';
import type { PortalTimelineEntry } from './public/types';
import { bandSeenOf, parseBandSeen, parseReviewSeen, reviewSeenOf, roundSeenOf } from './review-seen';

// F1/F2 (S1): the fingerprint of what the client saw changes exactly when the
// band, the render issuance or the renders shared change.

const render = (id: string) => ({ id, category: 'render' as const, sharedAt: null, commentCount: 0, access: 'preview' as const, media: 'image' as const });
const stage = (at: string): PortalTimelineEntry => ({ type: 'stage', stageKey: 'finalApproval', at });

describe('reviewSeenOf', () => {
  const base = { rom: { low: '900000.0000', high: '1200000.0000' }, timeline: [stage('2026-10-01T09:00:00.000Z')], documents: [render('b'), render('a')] };

  it('the band is its two figures; no band, no fingerprint', () => {
    expect(bandSeenOf(base)).toBe('900000.0000..1200000.0000');
    expect(bandSeenOf({ rom: null })).toBeNull();
    expect(bandSeenOf({ rom: { low: null, high: null } })).toBeNull();
  });

  it('a re-issued band, a new render issuance or a new render changes it; order does not', () => {
    const seen = reviewSeenOf(base);
    expect(reviewSeenOf({ ...base, documents: [render('a'), render('b')] })).toEqual(seen);
    expect(reviewSeenOf({ ...base, rom: { low: '1500000.0000', high: '2000000.0000' } }).band).not.toBe(seen.band);
    expect(roundSeenOf({ ...base, timeline: [stage('2026-10-05T09:00:00.000Z'), ...base.timeline] })).not.toBe(seen.round);
    expect(roundSeenOf({ ...base, documents: [...base.documents, render('c')] })).not.toBe(seen.round);
  });

  it('a later stage move (the studio moved on) does not change the round', () => {
    const moved: PortalTimelineEntry = { type: 'stage', stageKey: 'drawings', at: '2026-10-09T09:00:00.000Z' };
    expect(roundSeenOf({ ...base, timeline: [moved, ...base.timeline] })).toBe(roundSeenOf(base));
  });
});

describe('parsing what a browser sent', () => {
  it('accepts the shape, refuses anything else', () => {
    expect(parseReviewSeen({ band: null, round: 'x' })).toEqual({ band: null, round: 'x' });
    for (const junk of [null, 'x', {}, { band: 1, round: 'x' }, { band: null, round: 'y'.repeat(10_001) }]) {
      expect(parseReviewSeen(junk)).toBeNull();
    }
    expect(parseBandSeen('1..2')).toBe('1..2');
    expect(parseBandSeen(null)).toBeNull();
    expect(parseBandSeen(5)).toBeUndefined();
  });
});
