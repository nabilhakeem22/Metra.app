import type {
  DesignEngagement,
  EngagementMilestone,
  PaymentEvent,
} from '@metra/db';
import { describe, expect, it } from 'vitest';
import { GUARDS, type GuardFacts } from './guards';

// scopeInputsPresent reads only titleAr/titleEn/clientId/projectId, so a partial
// row cast to the full type is a faithful fixture. The ledger + schedule are
// empty here (scopeInputsPresent ignores them; depositCleared has its own facts).
function engagement(over: Partial<DesignEngagement>): GuardFacts {
  return {
    engagement: {
      titleAr: 'عنوان',
      titleEn: 'Title',
      clientId: 'c1',
      projectId: 'p1',
      ...over,
    } as DesignEngagement,
    milestones: [],
    payments: [],
  };
}

/** Build a facts bundle for depositCleared: fee + one deposit milestone + paid rows. */
function depositFacts(opts: {
  designFee: string | null;
  deposit?: { basis: 'percent' | 'amount'; value: string };
  paid: string[];
}): GuardFacts {
  const milestones: EngagementMilestone[] = opts.deposit
    ? [
        {
          kind: 'deposit',
          basis: opts.deposit.basis,
          value: opts.deposit.value,
        } as EngagementMilestone,
      ]
    : [];
  const payments: PaymentEvent[] = opts.paid.map(
    (amount) => ({ kind: 'deposit', amount }) as PaymentEvent,
  );
  return {
    engagement: { designFee: opts.designFee } as DesignEngagement,
    milestones,
    payments,
  };
}

describe('scopeInputsPresent', () => {
  it('passes when a title (either language), a client, and a project are set', () => {
    expect(GUARDS.scopeInputsPresent(engagement({}))).toEqual({ ok: true });
    expect(
      GUARDS.scopeInputsPresent(engagement({ titleAr: null })),
    ).toEqual({ ok: true });
    expect(
      GUARDS.scopeInputsPresent(engagement({ titleEn: null })),
    ).toEqual({ ok: true });
  });

  it('fails when both titles are absent/blank', () => {
    expect(
      GUARDS.scopeInputsPresent(engagement({ titleAr: '  ', titleEn: null })),
    ).toEqual({ ok: false, code: 'guard_scope_inputs_missing' });
  });

  it('fails when the client or project is missing', () => {
    expect(
      GUARDS.scopeInputsPresent(engagement({ clientId: '' as string })),
    ).toEqual({ ok: false, code: 'guard_scope_inputs_missing' });
    expect(
      GUARDS.scopeInputsPresent(engagement({ projectId: '' as string })),
    ).toEqual({ ok: false, code: 'guard_scope_inputs_missing' });
  });
});

describe('depositCleared', () => {
  it('amount basis: passes iff paid >= the deposit milestone value', () => {
    const base = { designFee: '100000', deposit: { basis: 'amount' as const, value: '30000' } };
    expect(GUARDS.depositCleared(depositFacts({ ...base, paid: ['30000'] }))).toEqual({ ok: true });
    // Two partial payments that sum to the required amount also clear it.
    expect(
      GUARDS.depositCleared(depositFacts({ ...base, paid: ['10000', '20000'] })),
    ).toEqual({ ok: true });
    // A shortfall fails closed.
    expect(GUARDS.depositCleared(depositFacts({ ...base, paid: ['29999.9999'] }))).toEqual({
      ok: false,
      code: 'deposit_not_cleared',
    });
    expect(GUARDS.depositCleared(depositFacts({ ...base, paid: [] }))).toEqual({
      ok: false,
      code: 'deposit_not_cleared',
    });
  });

  it('percent basis: required = design_fee × deposit% / 100 (exact)', () => {
    // 25% of 100,000 = 25,000 exactly.
    const base = { designFee: '100000', deposit: { basis: 'percent' as const, value: '25' } };
    expect(GUARDS.depositCleared(depositFacts({ ...base, paid: ['25000'] }))).toEqual({ ok: true });
    expect(GUARDS.depositCleared(depositFacts({ ...base, paid: ['24999.9999'] }))).toEqual({
      ok: false,
      code: 'deposit_not_cleared',
    });
  });

  it('ignores non-deposit payment kinds when summing PAID', () => {
    const facts = depositFacts({
      designFee: '100000',
      deposit: { basis: 'amount', value: '30000' },
      paid: [],
    });
    facts.payments = [
      { kind: 'gate_a', amount: '30000' } as PaymentEvent,
      { kind: 'balance', amount: '30000' } as PaymentEvent,
    ];
    expect(GUARDS.depositCleared(facts)).toEqual({ ok: false, code: 'deposit_not_cleared' });
  });

  it('fails closed when the deposit milestone or the design_fee is missing', () => {
    expect(
      GUARDS.depositCleared(depositFacts({ designFee: '100000', paid: ['999999'] })),
    ).toEqual({ ok: false, code: 'deposit_not_cleared' });
    expect(
      GUARDS.depositCleared(
        depositFacts({ designFee: null, deposit: { basis: 'percent', value: '25' }, paid: ['999999'] }),
      ),
    ).toEqual({ ok: false, code: 'deposit_not_cleared' });
  });
});

describe('pendingGuard', () => {
  it('always fails closed with transition_not_yet_enabled', () => {
    expect(GUARDS.pendingGuard(engagement({}))).toEqual({
      ok: false,
      code: 'transition_not_yet_enabled',
    });
    expect(
      GUARDS.pendingGuard(engagement({ titleAr: null, titleEn: null })),
    ).toEqual({ ok: false, code: 'transition_not_yet_enabled' });
  });
});
