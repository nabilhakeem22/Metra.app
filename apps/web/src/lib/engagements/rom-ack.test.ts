import { describe, expect, it } from 'vitest';
import { GUARDS } from './guards';
import type { GuardFacts } from './guards';
import { acknowledgesIssuance } from './rom-ack';
import type { DesignEngagement, EngagementEvent } from '@metra/db';

const ISSUED_AT = new Date('2026-01-01T00:00:00Z');
const RE_ISSUED_AT = new Date('2026-02-01T00:00:00Z');

describe('acknowledgesIssuance', () => {
  it('is true only for an acknowledgement of THIS issuance', () => {
    const event = { kind: 'rom_acknowledgement', acknowledgedIssueAt: ISSUED_AT };
    expect(acknowledgesIssuance(event, ISSUED_AT)).toBe(true);
    expect(acknowledgesIssuance(event, RE_ISSUED_AT)).toBe(false);
  });

  it('compares the INSTANT, not the object identity', () => {
    // Both sides cross a serialisation boundary (the timeline record reaches the
    // client component as JSON and is revived), so two distinct Date objects for
    // the same moment must agree.
    const event = {
      kind: 'rom_acknowledgement',
      acknowledgedIssueAt: new Date(ISSUED_AT.getTime()),
    };
    expect(acknowledgesIssuance(event, new Date(ISSUED_AT.toISOString()))).toBe(true);
  });

  it('is false when either side is absent', () => {
    // Unknown reads as "no": nothing issued means nothing to answer, and a legacy
    // row with no stamp is evidence nobody can read.
    expect(
      acknowledgesIssuance({ kind: 'rom_acknowledgement', acknowledgedIssueAt: null }, ISSUED_AT),
    ).toBe(false);
    expect(
      acknowledgesIssuance({ kind: 'rom_acknowledgement', acknowledgedIssueAt: ISSUED_AT }, null),
    ).toBe(false);
    expect(
      acknowledgesIssuance({ kind: 'rom_acknowledgement', acknowledgedIssueAt: null }, null),
    ).toBe(false);
  });

  it('is false for any other event kind, however it is stamped', () => {
    for (const kind of ['rom_range_set', 'rom_issued', 'concept_approval', '']) {
      expect(acknowledgesIssuance({ kind, acknowledgedIssueAt: ISSUED_AT }, ISSUED_AT)).toBe(false);
    }
  });
});

// THE PARITY CLAIM. The cockpit badge and the transition guard answer the same
// question from the same array, in two different processes. If they disagree, the
// studio is told the client has signed off while the button refuses to fire — and
// the UI is the one insisting nothing is wrong. Both call acknowledgesIssuance;
// this is the test that says so.
describe('badge and guard agree', () => {
  const BAND = { romLow: '1800000.0000', romHigh: '2400000.0000' };

  function factsFor(
    acknowledgedIssueAt: Date | null,
    romIssuedAt: Date | null,
  ): GuardFacts {
    return {
      engagement: { ...BAND, romIssuedAt } as DesignEngagement,
      milestones: [],
      payments: [],
      artifacts: [],
      changeOrders: [],
      events: [
        {
          id: 'ack',
          kind: 'rom_acknowledgement',
          rangeLow: BAND.romLow,
          rangeHigh: BAND.romHigh,
          acknowledgedIssueAt,
          decidedAt: new Date('2026-03-01T00:00:00Z'),
          createdAt: new Date('2026-03-01T00:00:00Z'),
        } as EngagementEvent,
      ],
    };
  }

  /** Exactly the expression in engagement-detail-client.tsx. */
  function badgeAwaitingAck(facts: GuardFacts): boolean {
    const romIssuedAt = facts.engagement.romIssuedAt;
    return (
      romIssuedAt !== null &&
      !facts.events.some((event) => acknowledgesIssuance(event, romIssuedAt))
    );
  }

  const cases: Array<[string, Date | null, Date | null]> = [
    ['acknowledged the current issuance', ISSUED_AT, ISSUED_AT],
    ['acknowledged a superseded issuance', ISSUED_AT, RE_ISSUED_AT],
    ['legacy acknowledgement, no stamp', null, ISSUED_AT],
  ];

  it.each(cases)('%s', (_name, acknowledgedIssueAt, romIssuedAt) => {
    const facts = factsFor(acknowledgedIssueAt, romIssuedAt);
    const guardPasses = GUARDS.romAcknowledged(facts).ok;
    expect(badgeAwaitingAck(facts)).toBe(!guardPasses);
  });
});
