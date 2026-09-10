import { describe, expect, it } from 'vitest';
import { ENGAGEMENT_EVENT_KINDS, type EngagementEventKind } from '@metra/db';
import {
  isClientGenerated,
  isRecordedOnBehalf,
  isValidOccurredOn,
  liveEvents,
  ON_BEHALF_KINDS,
} from './event-provenance';

describe('isValidOccurredOn', () => {
  const TODAY = '2026-09-10';

  it('accepts a real past day and today', () => {
    expect(isValidOccurredOn('2026-09-06', TODAY)).toBe(true);
    expect(isValidOccurredOn(TODAY, TODAY)).toBe(true);
  });

  it('rejects the future', () => {
    // A future date on an evidentiary record is a typo or a fabrication; you
    // cannot already have been told something that has not happened.
    expect(isValidOccurredOn('2026-09-11', TODAY)).toBe(false);
    expect(isValidOccurredOn('2027-01-01', TODAY)).toBe(false);
  });

  it('rejects a day the calendar does not have', () => {
    // `new Date('2026-02-31')` silently rolls to 2026-03-03. Round-tripping is
    // what catches it -- a plain regex would let it through and store the wrong
    // day without complaint.
    expect(isValidOccurredOn('2026-02-31', TODAY)).toBe(false);
    expect(isValidOccurredOn('2026-13-01', TODAY)).toBe(false);
    expect(isValidOccurredOn('2026-00-10', TODAY)).toBe(false);
  });

  it('rejects anything that is not a bare YYYY-MM-DD', () => {
    for (const bad of ['', '2026-9-6', '06/09/2026', '2026-09-06T10:00:00Z', 'today']) {
      expect(isValidOccurredOn(bad, TODAY), bad).toBe(false);
    }
  });
});

type Row = { id: string; kind: EngagementEventKind; supersedesEventId: string | null };
const row = (id: string, kind: EngagementEventKind, supersedes: string | null = null): Row => ({
  id,
  kind,
  supersedesEventId: supersedes,
});

describe('liveEvents', () => {
  it('drops the row a correction retracts', () => {
    // THE CONSEQUENCE THIS EXISTS FOR. `engagement_events` is INSERT-only by
    // grant, so a wrong acknowledgement cannot be deleted -- it is retracted by
    // a new row pointing at it. If the guards still counted the retracted row,
    // a mistake the studio has formally withdrawn would go on unlocking shop
    // drawings, which is the exact failure the correction was meant to fix.
    const live = liveEvents([
      row('ack', 'rom_acknowledgement'),
      row('fix', 'event_correction', 'ack'),
    ]);
    expect(live).toEqual([]);
  });

  it('drops the correction rows themselves', () => {
    // They are bookkeeping ABOUT the ledger, not events in it. A guard counting
    // one would be counting the retraction as though it were the act.
    const live = liveEvents([
      row('good', 'rom_acknowledgement'),
      row('bad', 'handoff_acknowledgement'),
      row('fix', 'event_correction', 'bad'),
    ]);
    expect(live.map((e) => e.id)).toEqual(['good']);
  });

  it('leaves an uncorrected ledger completely alone', () => {
    const rows = [
      row('a', 'rom_acknowledgement'),
      row('b', 'design_approval'),
      row('c', 'rom_range_set'),
    ];
    expect(liveEvents(rows)).toEqual(rows);
  });

  it('does not care what order the correction arrives in', () => {
    // Nothing guarantees the correction sorts after its target -- `decided_at`
    // is clock_timestamp and the query has no ORDER BY.
    const live = liveEvents([
      row('fix', 'event_correction', 'ack'),
      row('ack', 'rom_acknowledgement'),
    ]);
    expect(live).toEqual([]);
  });

  it('retracts each target independently', () => {
    const live = liveEvents([
      row('ack1', 'rom_acknowledgement'),
      row('ack2', 'rom_acknowledgement'),
      row('fix', 'event_correction', 'ack1'),
    ]);
    expect(live.map((e) => e.id)).toEqual(['ack2']);
  });
});

describe('isRecordedOnBehalf', () => {
  it('marks a staff-recorded acknowledgement', () => {
    // The whole point: these two are the client's acts, so a staff-channel row
    // for either is the studio asserting somebody else acted.
    expect(isRecordedOnBehalf('rom_acknowledgement', 'staff')).toBe(true);
    expect(isRecordedOnBehalf('handoff_acknowledgement', 'staff')).toBe(true);
  });

  it('does NOT mark the same kinds when the client generated them', () => {
    // Identical kind, opposite meaning. This is the distinction the Timeline was
    // failing to draw, and drawing it backwards would be worse than not at all.
    expect(isRecordedOnBehalf('rom_acknowledgement', 'client')).toBe(false);
    expect(isRecordedOnBehalf('handoff_acknowledgement', 'client')).toBe(false);
  });

  it('never marks the studio recording its own work', () => {
    // A band issued, an as-built attested, a design approved — all genuinely the
    // studio's acts. Marking them would cry wolf and devalue the real marker.
    for (const kind of ENGAGEMENT_EVENT_KINDS) {
      if (ON_BEHALF_KINDS.has(kind)) continue;
      expect(isRecordedOnBehalf(kind, 'staff'), kind).toBe(false);
    }
  });

  it('treats any non-client channel as staff', () => {
    // `actor_channel` is a text column with a 'staff' default, not an enum. An
    // unexpected value must fail SAFE — toward marking, never toward silently
    // presenting a studio record as the client's own.
    expect(isRecordedOnBehalf('rom_acknowledgement', '')).toBe(true);
    expect(isRecordedOnBehalf('rom_acknowledgement', 'system')).toBe(true);
  });
});

describe('isClientGenerated', () => {
  it('is true only for the client channel', () => {
    expect(isClientGenerated('client')).toBe(true);
    expect(isClientGenerated('staff')).toBe(false);
    expect(isClientGenerated('')).toBe(false);
  });
});
