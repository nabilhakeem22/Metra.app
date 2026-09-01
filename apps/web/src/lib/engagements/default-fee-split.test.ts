import { describe, expect, it } from 'vitest';
import {
  ALL_MILESTONE_KINDS,
  DEFAULT_MILESTONE_KINDS,
  OPTIONAL_MILESTONE_KINDS,
  byDueOrder,
} from './default-fee-split';
import { MONEY_GUARD_MILESTONE } from './guards/money';
import { TRANSITIONS, type Trigger } from './transitions';

describe('the default fee split', () => {
  it('is THREE payments: deposit, after the design is confirmed, and the final', () => {
    expect(DEFAULT_MILESTONE_KINDS).toEqual(['deposit', 'gate_b', 'balance']);
  });

  it('leaves gate_a OUT, and offers exactly that as the optional addition', () => {
    expect(DEFAULT_MILESTONE_KINDS).not.toContain('gate_a');
    expect(OPTIONAL_MILESTONE_KINDS).toEqual(['gate_a']);
  });

  it('covers every milestone kind between the default and the optional set', () => {
    // A kind added to the DB enum but to neither list would silently become
    // unbillable — the studio would have no row for it anywhere in the form.
    expect([...DEFAULT_MILESTONE_KINDS, ...OPTIONAL_MILESTONE_KINDS].sort()).toEqual(
      [...ALL_MILESTONE_KINDS].sort(),
    );
  });

  it('orders a built schedule by DUE date, not by the order rows were added', () => {
    const built = ['balance', 'deposit', 'gate_a', 'gate_b'] as const;
    expect([...built].sort(byDueOrder)).toEqual([
      'deposit',
      'gate_a',
      'gate_b',
      'balance',
    ]);
  });
});

describe('the default split needs no machine change', () => {
  it('names milestones the money guards actually gate on', () => {
    // Every default milestone must be a kind some money guard reads, or the studio
    // would collect against a slice that gates nothing.
    const gated = new Set(Object.values(MONEY_GUARD_MILESTONE));
    for (const kind of DEFAULT_MILESTONE_KINDS) {
      expect(gated.has(kind)).toBe(true);
    }
  });

  it('leaves gate_a a FREE gate when omitted — selectConcept still passes', () => {
    // The load-bearing rule that makes a three-payment schedule work with no
    // machine change: an ABSENT milestone means required = 0, so
    // `gateAInstallmentCleared` clears with no payment. This pins that
    // `selectConcept` carries ONLY that money guard, so omitting gate_a cannot
    // strand an engagement at concept_review.
    const guards = TRANSITIONS['selectConcept' as Trigger].guards;
    const moneyGuards = guards.filter((g) => g in MONEY_GUARD_MILESTONE);
    expect(moneyGuards).toEqual(['gateAInstallmentCleared']);
  });

  it('keeps the deposit in the default — validateFeeSchedule requires it', () => {
    // A schedule with no deposit is rejected outright (milestone_split_invalid),
    // so a default that omitted it would produce an unsubmittable form.
    expect(DEFAULT_MILESTONE_KINDS).toContain('deposit');
  });
});
