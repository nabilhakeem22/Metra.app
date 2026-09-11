import { describe, expect, it } from 'vitest';
import { DESIGN_STATES, isActive } from '@/lib/engagements/states';
import { spinePosition } from '@/lib/engagements/stage-spine';
import {
  daysSince,
  deliveryWaitingOn,
  isStale,
  STALE_AFTER_DAYS,
} from './deliveries';

describe('deliveryWaitingOn', () => {
  it('says the client owes every state that sits AT a gate', () => {
    // The claim the panel makes is "waiting at Gate A/B" — so the two notions
    // must agree, or the badge and the ribbon would contradict each other on
    // the same row.
    for (const state of DESIGN_STATES) {
      if (!isActive(state)) continue;
      if (spinePosition(state).atGate !== null) {
        expect(deliveryWaitingOn(state)).toBe('client');
      }
    }
  });

  it('does not blame the client for negotiation', () => {
    // Being in negotiation PROVES the Gate A instalment cleared (selectConcept's
    // only guard). Revisions are the studio's work.
    expect(deliveryWaitingOn('negotiation')).toBe('studio');
  });

  it('names the two non-gate client waits', () => {
    expect(deliveryWaitingOn('execution_decision')).toBe('client');
    expect(deliveryWaitingOn('design_only_handoff')).toBe('client');
  });

  it('leaves the drawing work with the studio', () => {
    for (const state of ['survey', 'layout', 'design_3d', 'shop_drawings', 'boq'] as const) {
      expect(deliveryWaitingOn(state)).toBe('studio');
    }
  });

  it('answers for every state in the machine', () => {
    for (const state of DESIGN_STATES) {
      expect(['client', 'studio']).toContain(deliveryWaitingOn(state));
    }
  });
});

describe('daysSince', () => {
  const now = new Date('2026-09-11T12:00:00.000Z');

  it('floors to whole days', () => {
    expect(daysSince('2026-09-11T00:00:00.000Z', now)).toBe(0);
    expect(daysSince('2026-09-10T11:00:00.000Z', now)).toBe(1);
    expect(daysSince('2026-08-31T12:00:00.000Z', now)).toBe(11);
  });

  it('reads a future stamp as today rather than a negative age', () => {
    // Clock skew between the app and Postgres must not make the panel look
    // broken; "-1 days" reads as a bug in the sort, not in the data.
    expect(daysSince('2026-09-12T12:00:00.000Z', now)).toBe(0);
  });

  it('survives an unparseable stamp', () => {
    expect(daysSince('not-a-date', now)).toBe(0);
  });
});

describe('isStale', () => {
  it('turns over at a week', () => {
    expect(isStale(STALE_AFTER_DAYS - 1)).toBe(false);
    expect(isStale(STALE_AFTER_DAYS)).toBe(true);
  });
});
