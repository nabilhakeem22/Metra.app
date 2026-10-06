import { describe, expect, it } from 'vitest';
import {
  ALL_MILESTONE_KINDS,
  DEFAULT_MILESTONE_KINDS,
  FALLBACK_FEE_SPLIT,
  OPTIONAL_MILESTONE_KINDS,
  byDueOrder,
  deriveFeeSplitPrefill,
  type LastFeeSchedule,
} from './default-fee-split';
import { MONEY_GUARD_MILESTONE } from './guards/trigger-money-gate';
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

describe('deriveFeeSplitPrefill', () => {
  const amounts = (designFee: string | null, values: [string, string, string]): LastFeeSchedule => ({
    designFee,
    milestones: [
      { kind: 'deposit', basis: 'amount', value: values[0] },
      { kind: 'gate_b', basis: 'amount', value: values[1] },
      { kind: 'balance', basis: 'amount', value: values[2] },
    ],
  });
  const valuesOf = (prefill: ReturnType<typeof deriveFeeSplitPrefill>) =>
    prefill.rows.map((row) => row.value);

  it('falls back to 50/30/20 with no schedule, or none billed', () => {
    for (const last of [null, { designFee: '1000.0000', milestones: [] }]) {
      const prefill = deriveFeeSplitPrefill(last);
      expect(prefill.source).toBe('fallback');
      expect(prefill.rows).toEqual(
        FALLBACK_FEE_SPLIT.map(({ kind, percent }) => ({ kind, value: percent })),
      );
    }
  });

  it('takes a percent schedule as it was, trailing zeros stripped', () => {
    const prefill = deriveFeeSplitPrefill({
      designFee: '90000.0000',
      milestones: [
        { kind: 'balance', basis: 'percent', value: '25.0000' },
        { kind: 'deposit', basis: 'percent', value: '40.5000' },
        { kind: 'gate_b', basis: 'percent', value: '34.5000' },
      ],
    });
    expect(prefill).toEqual({
      source: 'lastUsed',
      rows: [
        { kind: 'deposit', value: '40.5' },
        { kind: 'gate_b', value: '34.5' },
        { kind: 'balance', value: '25' },
      ],
    });
  });

  it('keeps an optional gate_a the last schedule billed, and leaves a default row it skipped empty', () => {
    const prefill = deriveFeeSplitPrefill({
      designFee: null,
      milestones: [
        { kind: 'deposit', basis: 'percent', value: '60.0000' },
        { kind: 'gate_a', basis: 'percent', value: '40.0000' },
      ],
    });
    expect(prefill.rows).toEqual([
      { kind: 'deposit', value: '60' },
      { kind: 'gate_a', value: '40' },
      { kind: 'gate_b', value: '' },
      { kind: 'balance', value: '' },
    ]);
  });

  it('converts an amount schedule to percent: 50000/30000/20000 of 100000 is 50/30/20', () => {
    expect(valuesOf(deriveFeeSplitPrefill(amounts('100000.0000', ['50000', '30000', '20000'])))).toEqual([
      '50',
      '30',
      '20',
    ]);
  });

  it('puts the rounding residual on the last paid row: 1/1/1 of 3 is 33.33/33.33/33.34', () => {
    expect(valuesOf(deriveFeeSplitPrefill(amounts('3.0000', ['1', '1', '1'])))).toEqual([
      '33.33',
      '33.33',
      '33.34',
    ]);
  });

  it('the residual never makes a row negative: 3333.5/3333.5/3332.5/0.5 of 10000', () => {
    const prefill = deriveFeeSplitPrefill({
      designFee: '10000.0000',
      milestones: [
        { kind: 'deposit', basis: 'amount', value: '3333.5' },
        { kind: 'gate_a', basis: 'amount', value: '3333.5' },
        { kind: 'gate_b', basis: 'amount', value: '3332.5' },
        { kind: 'balance', basis: 'amount', value: '0.5' },
      ],
    });
    const values = prefill.rows.map((row) => row.value);
    expect(values).toEqual(['33.34', '33.32', '33.33', '0.01']);
    for (const value of values) expect(Number(value)).toBeGreaterThanOrEqual(0);
    const hundredths = values.map((value) => Math.round(Number(value) * 100));
    expect(hundredths.reduce((sum, part) => sum + part, 0)).toBe(10000);
  });

  it('the residual skips a trailing zero row', () => {
    expect(valuesOf(deriveFeeSplitPrefill(amounts('3.0000', ['1', '2', '0'])))).toEqual([
      '33.33',
      '66.67',
      '0',
    ]);
  });

  it('falls back when an amount schedule has no usable fee', () => {
    expect(deriveFeeSplitPrefill(amounts(null, ['1', '1', '1'])).source).toBe('fallback');
    expect(deriveFeeSplitPrefill(amounts('0.0000', ['1', '1', '1'])).source).toBe('fallback');
  });
});
