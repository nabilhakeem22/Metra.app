import type {
  DesignEngagement,
  EngagementArtifact,
  EngagementChangeOrder,
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
    artifacts: [],
    changeOrders: [],
  };
}

/** Build a facts bundle for spatialBaseReady: offPlan flag + artifact kinds. */
function spatialFacts(
  offPlan: boolean,
  kinds: EngagementArtifact['kind'][],
): GuardFacts {
  return {
    engagement: { offPlan } as DesignEngagement,
    milestones: [],
    payments: [],
    artifacts: kinds.map((kind) => ({ kind }) as EngagementArtifact),
    changeOrders: [],
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
    artifacts: [],
    changeOrders: [],
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

/** Build a facts bundle for gateAInstallmentCleared: fee + one gate_a milestone + paid rows. */
function gateAFacts(opts: {
  designFee: string | null;
  gateA?: { basis: 'percent' | 'amount'; value: string };
  paid: string[];
}): GuardFacts {
  const milestones: EngagementMilestone[] = opts.gateA
    ? [
        {
          kind: 'gate_a',
          basis: opts.gateA.basis,
          value: opts.gateA.value,
        } as EngagementMilestone,
      ]
    : [];
  const payments: PaymentEvent[] = opts.paid.map(
    (amount) => ({ kind: 'gate_a', amount }) as PaymentEvent,
  );
  return {
    engagement: { designFee: opts.designFee } as DesignEngagement,
    milestones,
    payments,
    artifacts: [],
    changeOrders: [],
  };
}

describe('gateAInstallmentCleared', () => {
  it('amount basis: passes iff paid >= the gate_a milestone value (short/exact/over)', () => {
    const base = { designFee: '100000', gateA: { basis: 'amount' as const, value: '20000' } };
    // Exact clears.
    expect(GUARDS.gateAInstallmentCleared(gateAFacts({ ...base, paid: ['20000'] }))).toEqual({
      ok: true,
    });
    // Over clears; two partials that sum over also clear.
    expect(
      GUARDS.gateAInstallmentCleared(gateAFacts({ ...base, paid: ['15000', '10000'] })),
    ).toEqual({ ok: true });
    // A piastre short fails closed.
    expect(GUARDS.gateAInstallmentCleared(gateAFacts({ ...base, paid: ['19999.9999'] }))).toEqual({
      ok: false,
      code: 'gate_a_not_cleared',
    });
    expect(GUARDS.gateAInstallmentCleared(gateAFacts({ ...base, paid: [] }))).toEqual({
      ok: false,
      code: 'gate_a_not_cleared',
    });
  });

  it('percent basis: required = design_fee × gate_a% / 100 (exact)', () => {
    // 20% of 100,000 = 20,000 exactly.
    const base = { designFee: '100000', gateA: { basis: 'percent' as const, value: '20' } };
    expect(GUARDS.gateAInstallmentCleared(gateAFacts({ ...base, paid: ['20000'] }))).toEqual({
      ok: true,
    });
    expect(GUARDS.gateAInstallmentCleared(gateAFacts({ ...base, paid: ['19999.9999'] }))).toEqual({
      ok: false,
      code: 'gate_a_not_cleared',
    });
  });

  it('ignores non-gate_a payment kinds when summing PAID', () => {
    const facts = gateAFacts({
      designFee: '100000',
      gateA: { basis: 'amount', value: '20000' },
      paid: [],
    });
    facts.payments = [
      { kind: 'deposit', amount: '20000' } as PaymentEvent,
      { kind: 'balance', amount: '20000' } as PaymentEvent,
    ];
    expect(GUARDS.gateAInstallmentCleared(facts)).toEqual({
      ok: false,
      code: 'gate_a_not_cleared',
    });
  });

  it('fails closed when the gate_a milestone or the design_fee is missing', () => {
    expect(
      GUARDS.gateAInstallmentCleared(gateAFacts({ designFee: '100000', paid: ['999999'] })),
    ).toEqual({ ok: false, code: 'gate_a_not_cleared' });
    expect(
      GUARDS.gateAInstallmentCleared(
        gateAFacts({ designFee: null, gateA: { basis: 'percent', value: '20' }, paid: ['999999'] }),
      ),
    ).toEqual({ ok: false, code: 'gate_a_not_cleared' });
  });
});

describe('spatialBaseReady — the Off-Plan rule', () => {
  it('non-Off-Plan: requires a measured survey (a CAD alone does NOT satisfy it)', () => {
    expect(GUARDS.spatialBaseReady(spatialFacts(false, []))).toEqual({
      ok: false,
      code: 'spatial_base_missing',
    });
    expect(GUARDS.spatialBaseReady(spatialFacts(false, ['autocad']))).toEqual({
      ok: false,
      code: 'spatial_base_missing',
    });
    expect(GUARDS.spatialBaseReady(spatialFacts(false, ['survey']))).toEqual({
      ok: true,
    });
  });

  it('Off-Plan: a developer CAD OR a survey satisfies it; nothing does not', () => {
    expect(GUARDS.spatialBaseReady(spatialFacts(true, []))).toEqual({
      ok: false,
      code: 'spatial_base_missing',
    });
    expect(GUARDS.spatialBaseReady(spatialFacts(true, ['autocad']))).toEqual({
      ok: true,
    });
    expect(GUARDS.spatialBaseReady(spatialFacts(true, ['survey']))).toEqual({
      ok: true,
    });
  });
});

describe('optionsReady — the 2–4 concept-options gate', () => {
  /** A facts bundle with `conceptCount` concept_option artifacts, plus `extras`. */
  function optionsFacts(
    conceptCount: number,
    extras: EngagementArtifact['kind'][] = [],
  ): GuardFacts {
    const conceptOptions = Array.from(
      { length: conceptCount },
      () => ({ kind: 'concept_option' }) as EngagementArtifact,
    );
    const extraArtifacts = extras.map(
      (kind) => ({ kind }) as EngagementArtifact,
    );
    return {
      engagement: {} as DesignEngagement,
      milestones: [],
      payments: [],
      artifacts: [...conceptOptions, ...extraArtifacts],
      changeOrders: [],
    };
  }

  it('fails below the range: 0 and 1 concept options', () => {
    expect(GUARDS.optionsReady(optionsFacts(0))).toEqual({
      ok: false,
      code: 'concept_options_out_of_range',
    });
    expect(GUARDS.optionsReady(optionsFacts(1))).toEqual({
      ok: false,
      code: 'concept_options_out_of_range',
    });
  });

  it('passes inside the range: 2, 3, and 4 concept options', () => {
    expect(GUARDS.optionsReady(optionsFacts(2))).toEqual({ ok: true });
    expect(GUARDS.optionsReady(optionsFacts(3))).toEqual({ ok: true });
    expect(GUARDS.optionsReady(optionsFacts(4))).toEqual({ ok: true });
  });

  it('fails above the range: 5 concept options', () => {
    expect(GUARDS.optionsReady(optionsFacts(5))).toEqual({
      ok: false,
      code: 'concept_options_out_of_range',
    });
  });

  it('counts only concept_option artifacts — a survey/autocad never counts', () => {
    // One concept option + two non-concept artifacts is still below the range.
    expect(
      GUARDS.optionsReady(optionsFacts(1, ['survey', 'autocad'])),
    ).toEqual({ ok: false, code: 'concept_options_out_of_range' });
    // Two concept options pass even with extra non-concept artifacts present.
    expect(
      GUARDS.optionsReady(optionsFacts(2, ['survey', 'autocad'])),
    ).toEqual({ ok: true });
  });
});

describe('revisionCosSettled — the change-order settlement gate', () => {
  /** A facts bundle: raised/settled change-order amounts + revision_co payments. */
  function coFacts(opts: {
    raised?: string[];
    settled?: string[];
    revisionCoPaid?: string[];
    otherPaid?: { kind: PaymentEvent['kind']; amount: string }[];
  }): GuardFacts {
    const changeOrders: EngagementChangeOrder[] = [
      ...(opts.raised ?? []).map(
        (amount) => ({ status: 'raised', amount }) as EngagementChangeOrder,
      ),
      ...(opts.settled ?? []).map(
        (amount) => ({ status: 'settled', amount }) as EngagementChangeOrder,
      ),
    ];
    const payments: PaymentEvent[] = [
      ...(opts.revisionCoPaid ?? []).map(
        (amount) => ({ kind: 'revision_co', amount }) as PaymentEvent,
      ),
      ...(opts.otherPaid ?? []).map((p) => p as PaymentEvent),
    ];
    return {
      engagement: {} as DesignEngagement,
      milestones: [],
      payments,
      artifacts: [],
      changeOrders,
    };
  }

  it('passes trivially when there are NO raised change orders', () => {
    expect(GUARDS.revisionCosSettled(coFacts({}))).toEqual({ ok: true });
    // A settled CO with no matching payment still passes — only `raised` counts.
    expect(
      GUARDS.revisionCosSettled(coFacts({ settled: ['5000'] })),
    ).toEqual({ ok: true });
  });

  it('a raised CO with no revision_co payment fails closed', () => {
    expect(GUARDS.revisionCosSettled(coFacts({ raised: ['7500'] }))).toEqual({
      ok: false,
      code: 'revision_cos_outstanding',
    });
  });

  it('passes iff revision_co paid >= Σ raised (exact scale-4, short/exact/over)', () => {
    const base = { raised: ['7500.5000'] };
    expect(
      GUARDS.revisionCosSettled(coFacts({ ...base, revisionCoPaid: ['7500.4999'] })),
    ).toEqual({ ok: false, code: 'revision_cos_outstanding' });
    expect(
      GUARDS.revisionCosSettled(coFacts({ ...base, revisionCoPaid: ['7500.5000'] })),
    ).toEqual({ ok: true });
    expect(
      GUARDS.revisionCosSettled(coFacts({ ...base, revisionCoPaid: ['8000'] })),
    ).toEqual({ ok: true });
  });

  it('aggregates: two raised COs need the SUM covered; partials that sum clear', () => {
    const base = { raised: ['1000', '2000'] };
    // Covering only one CO is not enough.
    expect(
      GUARDS.revisionCosSettled(coFacts({ ...base, revisionCoPaid: ['1000'] })),
    ).toEqual({ ok: false, code: 'revision_cos_outstanding' });
    // Two partial payments summing to the 3000 total clear it.
    expect(
      GUARDS.revisionCosSettled(coFacts({ ...base, revisionCoPaid: ['1500', '1500'] })),
    ).toEqual({ ok: true });
  });

  it('KIND-ISOLATION: a deposit/gate_a payment of the same size does NOT settle a CO', () => {
    expect(
      GUARDS.revisionCosSettled(
        coFacts({
          raised: ['5000'],
          otherPaid: [
            { kind: 'deposit', amount: '5000' },
            { kind: 'gate_a', amount: '5000' },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: 'revision_cos_outstanding' });
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
