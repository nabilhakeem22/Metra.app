import { describe, expect, it } from 'vitest';
import { ENGAGEMENT_EVENT_KINDS } from '@metra/db';
import {
  isClientGenerated,
  isRecordedOnBehalf,
  ON_BEHALF_KINDS,
} from './event-provenance';

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
