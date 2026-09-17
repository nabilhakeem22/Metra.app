import { describe, expect, test } from 'vitest';
import { resolveBudgetBadge, type BudgetBadgeHeader } from './budget-badge';
import type { AcknowledgementEvent } from './rom-ack';

const ISSUED_AT = new Date('2026-06-01T10:00:00.000Z');
const SUPERSEDED_AT = new Date('2026-05-01T10:00:00.000Z');

function header(overrides: Partial<BudgetBadgeHeader> = {}): BudgetBadgeHeader {
  return { romLow: '100000.0000', romHigh: '140000.0000', romIssuedAt: null, ...overrides };
}

function acknowledgement(at: Date | null): AcknowledgementEvent {
  return { kind: 'rom_acknowledgement', acknowledgedIssueAt: at };
}

describe('resolveBudgetBadge', () => {
  test('both bounds set and never issued is a DRAFT', () => {
    expect(resolveBudgetBadge(header(), [])).toBe('draft');
  });

  test('no band at all is no badge — a permanent draft badge says nothing', () => {
    expect(resolveBudgetBadge(header({ romLow: null, romHigh: null }), [])).toBeNull();
  });

  test('half a band is not a draft', () => {
    expect(resolveBudgetBadge(header({ romHigh: null }), [])).toBeNull();
  });

  test('issued with no acknowledgement is AWAITING the client', () => {
    expect(resolveBudgetBadge(header({ romIssuedAt: ISSUED_AT }), [])).toBe('awaitingAck');
  });

  test('issued and acknowledged for THIS issuance is no badge', () => {
    expect(
      resolveBudgetBadge(header({ romIssuedAt: ISSUED_AT }), [acknowledgement(ISSUED_AT)]),
    ).toBe(null);
  });

  // 0049. This is the row the badge exists for: the client acknowledged an
  // EARLIER band, the studio then reissued, and the studio is still waiting.
  test('an acknowledgement naming a SUPERSEDED issuance still leaves awaitingAck', () => {
    expect(
      resolveBudgetBadge(header({ romIssuedAt: ISSUED_AT }), [acknowledgement(SUPERSEDED_AT)]),
    ).toBe('awaitingAck');
  });

  test('an acknowledgement with no recorded issuance instant does not clear it', () => {
    expect(
      resolveBudgetBadge(header({ romIssuedAt: ISSUED_AT }), [acknowledgement(null)]),
    ).toBe('awaitingAck');
  });

  test('an event of another kind at the right instant does not clear it', () => {
    expect(
      resolveBudgetBadge(header({ romIssuedAt: ISSUED_AT }), [
        { kind: 'note', acknowledgedIssueAt: ISSUED_AT },
      ]),
    ).toBe('awaitingAck');
  });

  test('DRAFT outranks nothing else: once issued, the band is no longer a draft', () => {
    expect(resolveBudgetBadge(header({ romIssuedAt: ISSUED_AT }), [])).not.toBe('draft');
  });
});
