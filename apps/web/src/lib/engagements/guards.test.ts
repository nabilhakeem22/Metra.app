import type {
  DesignEngagement,
  EngagementArtifact,
  EngagementChangeOrder,
  EngagementEvent,
  EngagementMilestone,
  PaymentEvent,
} from '@metra/db';
import { describe, expect, it } from 'vitest';
import { GUARDS, moneyGuardOf, type GuardFacts } from './guards';

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
    events: [],
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
    events: [],
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
    events: [],
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

  it('absent deposit milestone = free gate: clears with no payment (Step 14)', () => {
    // The firm omitted the deposit from the schedule — nothing is required.
    // (deposit is always present after Step 3, so this is a pure-function witness.)
    expect(
      GUARDS.depositCleared(depositFacts({ designFee: '100000', paid: [] })),
    ).toEqual({ ok: true });
  });

  it('fails closed when the milestone EXISTS but the design_fee is missing', () => {
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
    events: [],
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

  it('absent gate_a milestone = free gate: a deposit-only schedule clears gate_a free (Step 14)', () => {
    // No gate_a milestone in the schedule -> nothing required -> clears with no
    // gate_a payment. This is the milestoneCleared "absent = free" change.
    expect(
      GUARDS.gateAInstallmentCleared(gateAFacts({ designFee: '100000', paid: [] })),
    ).toEqual({ ok: true });
  });

  it('fails closed when the gate_a milestone EXISTS but the design_fee is missing', () => {
    expect(
      GUARDS.gateAInstallmentCleared(
        gateAFacts({ designFee: null, gateA: { basis: 'percent', value: '20' }, paid: ['999999'] }),
      ),
    ).toEqual({ ok: false, code: 'gate_a_not_cleared' });
  });
});

/** Build a facts bundle for gateBInstallmentCleared: fee + optional gate_b milestone + paid rows. */
function gateBFacts(opts: {
  designFee: string | null;
  gateB?: { basis: 'percent' | 'amount'; value: string };
  paid: { kind: PaymentEvent['kind']; amount: string }[];
}): GuardFacts {
  const milestones: EngagementMilestone[] = opts.gateB
    ? [
        {
          kind: 'gate_b',
          basis: opts.gateB.basis,
          value: opts.gateB.value,
        } as EngagementMilestone,
      ]
    : [];
  return {
    engagement: { designFee: opts.designFee } as DesignEngagement,
    milestones,
    payments: opts.paid.map((p) => p as PaymentEvent),
    artifacts: [],
    changeOrders: [],
    events: [],
  };
}

describe('gateBInstallmentCleared', () => {
  it('amount basis: passes iff gate_b paid >= the milestone value (short/exact/over)', () => {
    const base = { designFee: '100000', gateB: { basis: 'amount' as const, value: '20000' } };
    expect(
      GUARDS.gateBInstallmentCleared(gateBFacts({ ...base, paid: [{ kind: 'gate_b', amount: '20000' }] })),
    ).toEqual({ ok: true });
    // A piastre short fails closed.
    expect(
      GUARDS.gateBInstallmentCleared(
        gateBFacts({ ...base, paid: [{ kind: 'gate_b', amount: '19999.9999' }] }),
      ),
    ).toEqual({ ok: false, code: 'gate_b_not_cleared' });
    expect(
      GUARDS.gateBInstallmentCleared(gateBFacts({ ...base, paid: [] })),
    ).toEqual({ ok: false, code: 'gate_b_not_cleared' });
  });

  it('absent gate_b milestone = free gate: clears with no gate_b payment (Step 14)', () => {
    expect(
      GUARDS.gateBInstallmentCleared(gateBFacts({ designFee: '100000', paid: [] })),
    ).toEqual({ ok: true });
  });

  it('KIND-ISOLATION: a deposit/gate_a payment does NOT satisfy gate_b', () => {
    const base = { designFee: '100000', gateB: { basis: 'amount' as const, value: '20000' } };
    expect(
      GUARDS.gateBInstallmentCleared(
        gateBFacts({
          ...base,
          paid: [
            { kind: 'deposit', amount: '20000' },
            { kind: 'gate_a', amount: '20000' },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: 'gate_b_not_cleared' });
  });
});

/** Build an as_built_attestation event fixture with an explicit decidedAt/createdAt/id. */
function attestation(over: {
  id: string;
  hasVariance: boolean;
  decidedAt: Date;
  createdAt?: Date;
}): EngagementEvent {
  return {
    id: over.id,
    kind: 'as_built_attestation',
    hasVariance: over.hasVariance,
    decidedAt: over.decidedAt,
    createdAt: over.createdAt ?? over.decidedAt,
  } as EngagementEvent;
}

describe('romAcknowledged', () => {
  function romFacts(kinds: EngagementEvent['kind'][]): GuardFacts {
    return {
      engagement: {} as DesignEngagement,
      milestones: [],
      payments: [],
      artifacts: [],
      changeOrders: [],
      events: kinds.map((kind) => ({ kind }) as EngagementEvent),
    };
  }

  it('passes when a rom_acknowledgement event is present', () => {
    expect(GUARDS.romAcknowledged(romFacts(['rom_acknowledgement']))).toEqual({
      ok: true,
    });
    expect(
      GUARDS.romAcknowledged(romFacts(['concept_approval', 'rom_acknowledgement'])),
    ).toEqual({ ok: true });
  });

  it('fails closed with rom_not_acknowledged when no such event exists', () => {
    expect(GUARDS.romAcknowledged(romFacts([]))).toEqual({
      ok: false,
      code: 'rom_not_acknowledged',
    });
    // A different event kind does not satisfy it.
    expect(GUARDS.romAcknowledged(romFacts(['concept_approval']))).toEqual({
      ok: false,
      code: 'rom_not_acknowledged',
    });
  });
});

describe('asBuiltReconciled', () => {
  function reconcileFacts(
    asBuiltDue: boolean,
    events: EngagementEvent[],
  ): GuardFacts {
    return {
      engagement: { asBuiltDue } as DesignEngagement,
      milestones: [],
      payments: [],
      artifacts: [],
      changeOrders: [],
      events,
    };
  }

  it('non-Off-Plan (asBuiltDue false): trivially reconciled, passes with no attestation', () => {
    expect(GUARDS.asBuiltReconciled(reconcileFacts(false, []))).toEqual({
      ok: true,
    });
  });

  it('Off-Plan with NO attestation: fails closed with as_built_not_reconciled', () => {
    expect(GUARDS.asBuiltReconciled(reconcileFacts(true, []))).toEqual({
      ok: false,
      code: 'as_built_not_reconciled',
    });
  });

  it('Off-Plan: passes iff the LATEST attestation (by decidedAt) is clean', () => {
    const older = attestation({
      id: 'a',
      hasVariance: true,
      decidedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newerClean = attestation({
      id: 'b',
      hasVariance: false,
      decidedAt: new Date('2026-02-01T00:00:00Z'),
    });
    // Latest is clean -> reconciled (order in the array must not matter).
    expect(
      GUARDS.asBuiltReconciled(reconcileFacts(true, [older, newerClean])),
    ).toEqual({ ok: true });
    expect(
      GUARDS.asBuiltReconciled(reconcileFacts(true, [newerClean, older])),
    ).toEqual({ ok: true });
  });

  it('Off-Plan: a variance-flagged LATEST attestation fails closed', () => {
    const olderClean = attestation({
      id: 'a',
      hasVariance: false,
      decidedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const newerVariance = attestation({
      id: 'b',
      hasVariance: true,
      decidedAt: new Date('2026-02-01T00:00:00Z'),
    });
    expect(
      GUARDS.asBuiltReconciled(reconcileFacts(true, [olderClean, newerVariance])),
    ).toEqual({ ok: false, code: 'as_built_not_reconciled' });
  });

  it('Off-Plan: ties on decidedAt break by createdAt then id (deterministic latest)', () => {
    const decided = new Date('2026-03-01T00:00:00Z');
    const variance = attestation({
      id: 'zzz',
      hasVariance: true,
      decidedAt: decided,
      createdAt: new Date('2026-03-01T00:00:05Z'),
    });
    const clean = attestation({
      id: 'aaa',
      hasVariance: false,
      decidedAt: decided,
      createdAt: new Date('2026-03-01T00:00:01Z'),
    });
    // Same-ish decidedAt: the later createdAt (variance) is the latest -> fails.
    expect(
      GUARDS.asBuiltReconciled(reconcileFacts(true, [clean, variance])),
    ).toEqual({ ok: false, code: 'as_built_not_reconciled' });
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
      events: [],
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
      events: [],
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

describe('rendersPresent', () => {
  // Reuses spatialFacts (offPlan is irrelevant here): it builds the artifacts
  // bundle from a list of kinds, which is all rendersPresent reads.
  it('passes with at least one approved_render', () => {
    expect(GUARDS.rendersPresent(spatialFacts(false, ['approved_render']))).toEqual(
      { ok: true },
    );
    expect(
      GUARDS.rendersPresent(
        spatialFacts(false, ['survey', 'approved_render', 'concept_option']),
      ),
    ).toEqual({ ok: true });
  });

  it('fails closed with renders_missing when no approved_render is present', () => {
    expect(GUARDS.rendersPresent(spatialFacts(false, []))).toEqual({
      ok: false,
      code: 'renders_missing',
    });
    // A survey / CAD / concept option in the bundle never counts as a render.
    expect(
      GUARDS.rendersPresent(spatialFacts(false, ['survey', 'concept_option'])),
    ).toEqual({ ok: false, code: 'renders_missing' });
  });
});

describe('asBuiltDueOpen', () => {
  /** A facts bundle carrying only the `asBuiltDue` flag the guard reads. */
  function dueFacts(asBuiltDue: boolean | null): GuardFacts {
    return {
      engagement: { asBuiltDue } as DesignEngagement,
      milestones: [],
      payments: [],
      artifacts: [],
      changeOrders: [],
      events: [],
    };
  }

  it('passes when the as-built drawings are due', () => {
    expect(GUARDS.asBuiltDueOpen(dueFacts(true))).toEqual({ ok: true });
  });

  it('fails closed with as_built_not_due when not due (false or null)', () => {
    expect(GUARDS.asBuiltDueOpen(dueFacts(false))).toEqual({
      ok: false,
      code: 'as_built_not_due',
    });
    expect(GUARDS.asBuiltDueOpen(dueFacts(null))).toEqual({
      ok: false,
      code: 'as_built_not_due',
    });
  });
});

describe('shopDrawingsPresent', () => {
  // Reuses spatialFacts (offPlan is irrelevant): it builds the artifacts bundle
  // from a list of kinds, which is all shopDrawingsPresent reads.
  it('passes with at least one shop_drawing artifact', () => {
    expect(
      GUARDS.shopDrawingsPresent(spatialFacts(false, ['shop_drawing'])),
    ).toEqual({ ok: true });
    expect(
      GUARDS.shopDrawingsPresent(
        spatialFacts(false, ['approved_render', 'shop_drawing', 'boq']),
      ),
    ).toEqual({ ok: true });
  });

  it('fails closed with shop_drawings_missing when none is present', () => {
    expect(GUARDS.shopDrawingsPresent(spatialFacts(false, []))).toEqual({
      ok: false,
      code: 'shop_drawings_missing',
    });
    // A render / BOQ / survey in the bundle never counts as a shop drawing.
    expect(
      GUARDS.shopDrawingsPresent(
        spatialFacts(false, ['approved_render', 'boq', 'survey']),
      ),
    ).toEqual({ ok: false, code: 'shop_drawings_missing' });
  });
});

describe('boqPresent', () => {
  it('passes with at least one boq artifact', () => {
    expect(GUARDS.boqPresent(spatialFacts(false, ['boq']))).toEqual({
      ok: true,
    });
    expect(
      GUARDS.boqPresent(spatialFacts(false, ['shop_drawing', 'boq'])),
    ).toEqual({ ok: true });
  });

  it('fails closed with boq_missing when none is present', () => {
    expect(GUARDS.boqPresent(spatialFacts(false, []))).toEqual({
      ok: false,
      code: 'boq_missing',
    });
    // A shop drawing / render in the bundle never counts as a BOQ.
    expect(
      GUARDS.boqPresent(spatialFacts(false, ['shop_drawing', 'approved_render'])),
    ).toEqual({ ok: false, code: 'boq_missing' });
  });
});

describe('handoffAcknowledged', () => {
  function handoffFacts(kinds: EngagementEvent['kind'][]): GuardFacts {
    return {
      engagement: {} as DesignEngagement,
      milestones: [],
      payments: [],
      artifacts: [],
      changeOrders: [],
      events: kinds.map((kind) => ({ kind }) as EngagementEvent),
    };
  }

  it('passes when a handoff_acknowledgement event is present (any channel)', () => {
    expect(
      GUARDS.handoffAcknowledged(handoffFacts(['handoff_acknowledgement'])),
    ).toEqual({ ok: true });
    expect(
      GUARDS.handoffAcknowledged(
        handoffFacts(['design_approval', 'handoff_acknowledgement']),
      ),
    ).toEqual({ ok: true });
  });

  it('fails closed with handoff_not_acknowledged when no such event exists', () => {
    expect(GUARDS.handoffAcknowledged(handoffFacts([]))).toEqual({
      ok: false,
      code: 'handoff_not_acknowledged',
    });
    // A ROM ack / design approval does not satisfy it.
    expect(
      GUARDS.handoffAcknowledged(
        handoffFacts(['rom_acknowledgement', 'design_approval']),
      ),
    ).toEqual({ ok: false, code: 'handoff_not_acknowledged' });
  });
});

/** Build a facts bundle for balanceCleared: fee + optional balance milestone + paid rows. */
function balanceFacts(opts: {
  designFee: string | null;
  balance?: { basis: 'percent' | 'amount'; value: string };
  paid: { kind: PaymentEvent['kind']; amount: string }[];
}): GuardFacts {
  const milestones: EngagementMilestone[] = opts.balance
    ? [
        {
          kind: 'balance',
          basis: opts.balance.basis,
          value: opts.balance.value,
        } as EngagementMilestone,
      ]
    : [];
  return {
    engagement: { designFee: opts.designFee } as DesignEngagement,
    milestones,
    payments: opts.paid.map((p) => p as PaymentEvent),
    artifacts: [],
    changeOrders: [],
    events: [],
  };
}

describe('balanceCleared', () => {
  it('amount basis: passes iff balance paid >= the milestone value (short/exact)', () => {
    const base = { designFee: '100000', balance: { basis: 'amount' as const, value: '30000' } };
    expect(
      GUARDS.balanceCleared(
        balanceFacts({ ...base, paid: [{ kind: 'balance', amount: '30000' }] }),
      ),
    ).toEqual({ ok: true });
    // Two partials that sum to the requirement also clear it.
    expect(
      GUARDS.balanceCleared(
        balanceFacts({
          ...base,
          paid: [
            { kind: 'balance', amount: '10000' },
            { kind: 'balance', amount: '20000' },
          ],
        }),
      ),
    ).toEqual({ ok: true });
    // A piastre short fails closed.
    expect(
      GUARDS.balanceCleared(
        balanceFacts({ ...base, paid: [{ kind: 'balance', amount: '29999.9999' }] }),
      ),
    ).toEqual({ ok: false, code: 'balance_not_cleared' });
    expect(GUARDS.balanceCleared(balanceFacts({ ...base, paid: [] }))).toEqual({
      ok: false,
      code: 'balance_not_cleared',
    });
  });

  it('percent basis: required = design_fee × balance% / 100 (exact)', () => {
    // 30% of 100,000 = 30,000 exactly.
    const base = { designFee: '100000', balance: { basis: 'percent' as const, value: '30' } };
    expect(
      GUARDS.balanceCleared(
        balanceFacts({ ...base, paid: [{ kind: 'balance', amount: '30000' }] }),
      ),
    ).toEqual({ ok: true });
    expect(
      GUARDS.balanceCleared(
        balanceFacts({ ...base, paid: [{ kind: 'balance', amount: '29999.9999' }] }),
      ),
    ).toEqual({ ok: false, code: 'balance_not_cleared' });
  });

  it('KIND-ISOLATION: a gate_b/deposit surplus does NOT satisfy the balance', () => {
    const base = { designFee: '100000', balance: { basis: 'amount' as const, value: '30000' } };
    expect(
      GUARDS.balanceCleared(
        balanceFacts({
          ...base,
          paid: [
            { kind: 'gate_b', amount: '30000' },
            { kind: 'deposit', amount: '30000' },
          ],
        }),
      ),
    ).toEqual({ ok: false, code: 'balance_not_cleared' });
  });

  it('absent balance milestone = free gate: clears with no balance payment', () => {
    expect(
      GUARDS.balanceCleared(balanceFacts({ designFee: '100000', paid: [] })),
    ).toEqual({ ok: true });
  });

  it('fails closed when the balance milestone EXISTS but the design_fee is missing', () => {
    expect(
      GUARDS.balanceCleared(
        balanceFacts({
          designFee: null,
          balance: { basis: 'percent', value: '30' },
          paid: [{ kind: 'balance', amount: '999999' }],
        }),
      ),
    ).toEqual({ ok: false, code: 'balance_not_cleared' });
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

describe('moneyGuardOf', () => {
  it('maps each pay-and-advance trigger to its money-milestone guard', () => {
    expect(moneyGuardOf('confirmAndPayDeposit')).toBe('depositCleared');
    expect(moneyGuardOf('selectConcept')).toBe('gateAInstallmentCleared');
    // approveDesign carries romAcknowledged + asBuiltReconciled first, but the
    // ONLY money guard is gateBInstallmentCleared.
    expect(moneyGuardOf('approveDesign')).toBe('gateBInstallmentCleared');
    // BOTH execution-decision exits ride the balance gate (owner-locked), so
    // pay-and-advance accepts a 'balance' receipt with either trigger.
    expect(moneyGuardOf('chooseExecution')).toBe('balanceCleared');
    expect(moneyGuardOf('chooseDesignOnly')).toBe('balanceCleared');
  });

  it('returns null for a trigger with no money-milestone guard', () => {
    expect(moneyGuardOf('spatialBaseReady')).toBeNull();
    expect(moneyGuardOf('requestRevision')).toBeNull();
    expect(moneyGuardOf('confirmConcept')).toBeNull();
    expect(moneyGuardOf('submitDesignFee')).toBeNull();
    expect(moneyGuardOf('draftReady')).toBeNull();
    expect(moneyGuardOf('recipientAcknowledges')).toBeNull();
    expect(moneyGuardOf('abandon')).toBeNull();
  });
});
