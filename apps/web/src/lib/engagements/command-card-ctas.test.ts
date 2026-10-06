import { describe, expect, test } from 'vitest';
import { resolveCommandCardCtas } from './command-card-ctas';
import type { EngagementGatePreview } from './gate-preview';
import { CONCEPT_OPTION_MAX } from './concept-options';

function preview(
  overrides: Partial<EngagementGatePreview> = {},
): EngagementGatePreview {
  return {
    primaryTrigger: 'confirmAndPayDeposit',
    endingChoices: [],
    items: [],
    allClear: false,
    awaitingClientReview: false,
    clientDecision: null,
    ...overrides,
  };
}

const DEPOSIT_DUE: EngagementGatePreview['items'][number] = {
  guard: 'depositCleared',
  ok: false,
  code: 'deposit_not_cleared',
  amountDue: '25000.0000',
};

const NON_MONEY_UNMET: EngagementGatePreview['items'][number] = {
  guard: 'romAcknowledged',
  ok: false,
  code: 'rom_not_acknowledged',
  amountDue: null,
};

type CtaOptions = Parameters<typeof resolveCommandCardCtas>[1];

const BASE: CtaOptions = {
  canRecordPayment: true,
  canAdvance: true,
  canUpload: true,
  state: 'created',
  mode: 'blockedStudio',
  closed: false,
  conceptOptionCount: 0,
  pendingClaimCount: 0,
  canResolveClaims: true,
  awaitingClientReview: false,
  offlineApprovalEnabled: false,
};

const resolve = (
  gate: EngagementGatePreview,
  options: Partial<CtaOptions> = {},
) => resolveCommandCardCtas(gate, { ...BASE, ...options });

describe('resolveCommandCardCtas — the pay-and-advance path', () => {
  test('a blocking money gate with a shortfall offers the pay CTA and its kind', () => {
    const ctas = resolve(preview({ items: [DEPOSIT_DUE] }));
    expect(ctas.payCta).toBe('payAndAdvance');
    expect(ctas.paymentKind).toBe('deposit');
    expect(ctas.paymentItem?.amountDue).toBe('25000.0000');
  });

  test('an unmet NON-money guard is not a payment gate', () => {
    const ctas = resolve(preview({ items: [NON_MONEY_UNMET] }));
    expect(ctas.payCta).toBeNull();
    expect(ctas.paymentItem).toBeUndefined();
  });

  test('a money guard that is already OK offers nothing', () => {
    const ctas = resolve(preview({ items: [{ ...DEPOSIT_DUE, ok: true }] }));
    expect(ctas.payCta).toBeNull();
  });

  test('a money guard with NO amountDue offers nothing — there is nothing to pre-fill', () => {
    const ctas = resolve(preview({ items: [{ ...DEPOSIT_DUE, amountDue: null }] }));
    expect(ctas.payCta).toBeNull();
  });

  test('without the finance capability the CTA is withheld, but the item is still found', () => {
    const ctas = resolve(preview({ items: [DEPOSIT_DUE] }), { canRecordPayment: false });
    expect(ctas.payCta).toBeNull();
    expect(ctas.paymentItem).toBeDefined();
  });

  test('without canAdvance the pay-AND-ADVANCE CTA is withheld', () => {
    expect(resolve(preview({ items: [DEPOSIT_DUE] }), { canAdvance: false }).payCta).toBeNull();
  });

  test('with no forward trigger there is nothing to advance to', () => {
    const ctas = resolve(preview({ items: [DEPOSIT_DUE], primaryTrigger: null }));
    expect(ctas.payCta).toBeNull();
  });
});

const BALANCE_DUE: EngagementGatePreview['items'][number] = {
  guard: 'balanceCleared',
  ok: false,
  code: 'balance_not_cleared',
  amountDue: '30000.0000',
};

const CHOICE = preview({
  primaryTrigger: null,
  endingChoices: ['chooseDesignOnly', 'chooseExecution'],
  items: [BALANCE_DUE],
});

describe('resolveCommandCardCtas — the choice state and pending claims', () => {
  test('at the ending choice the money button only records', () => {
    const ctas = resolve(CHOICE, { state: 'execution_decision', mode: 'blockedClient' });
    expect(ctas.payCta).toBe('recordOnly');
    expect(ctas.paymentKind).toBe('balance');
  });

  test('record-only still needs the finance capability', () => {
    expect(
      resolve(CHOICE, { state: 'execution_decision', canRecordPayment: false }).payCta,
    ).toBeNull();
  });

  test('a pending claim hides the money button, at the choice and elsewhere', () => {
    expect(resolve(CHOICE, { pendingClaimCount: 1 }).payCta).toBeNull();
    expect(resolve(preview({ items: [DEPOSIT_DUE] }), { pendingClaimCount: 1 }).payCta).toBeNull();
  });

  test('confirmClaims needs a live card, a pending claim and the resolve right', () => {
    expect(resolve(preview(), { pendingClaimCount: 1 }).confirmClaims).toBe(true);
    expect(resolve(preview(), { pendingClaimCount: 0 }).confirmClaims).toBe(false);
    expect(
      resolve(preview(), { pendingClaimCount: 1, canResolveClaims: false }).confirmClaims,
    ).toBe(false);
    expect(resolve(preview(), { pendingClaimCount: 1, closed: true }).confirmClaims).toBe(false);
  });
});

describe('resolveCommandCardCtas — dropzoneRemaining', () => {
  test('counts the concept options still allowed, never below zero', () => {
    expect(resolve(preview(), { state: 'layout', conceptOptionCount: 2 }).dropzoneRemaining).toBe(
      CONCEPT_OPTION_MAX - 2,
    );
    expect(
      resolve(preview(), { state: 'layout', conceptOptionCount: CONCEPT_OPTION_MAX + 1 })
        .dropzoneRemaining,
    ).toBe(0);
  });

  test('is null for an uncapped category', () => {
    expect(resolve(preview(), { state: 'design_3d' }).dropzoneRemaining).toBeNull();
  });
});

describe('resolveCommandCardCtas — the inline dropzone and actOnCard', () => {
  test('a stage with a dropzone, a blocked studio and upload rights puts the act ON the card', () => {
    const ctas = resolve(preview(), { state: 'survey' });
    expect(ctas.dropzoneCategory).toBe('survey');
    expect(ctas.actOnCard).toBe(true);
  });

  test('a stage with NO dropzone leaves Advance in place', () => {
    const ctas = resolve(preview(), { state: 'created' });
    expect(ctas.dropzoneCategory).toBeNull();
    expect(ctas.actOnCard).toBe(false);
  });

  test('concept options AT CAPACITY stop offering an upload — append-only, no way back', () => {
    const ctas = resolve(preview(), {
      state: 'layout',
      conceptOptionCount: CONCEPT_OPTION_MAX,
    });
    expect(ctas.dropzoneCategory).toBe('conceptOption');
    expect(ctas.dropzoneAtCapacity).toBe(true);
    expect(ctas.actOnCard).toBe(false);
  });

  test('one under the cap still offers it', () => {
    const ctas = resolve(preview(), {
      state: 'layout',
      conceptOptionCount: CONCEPT_OPTION_MAX - 1,
    });
    expect(ctas.dropzoneAtCapacity).toBe(false);
    expect(ctas.actOnCard).toBe(true);
  });

  test('the capacity rule applies to conceptOption only', () => {
    const ctas = resolve(preview(), { state: 'design_3d', conceptOptionCount: 99 });
    expect(ctas.dropzoneCategory).toBe('render');
    expect(ctas.dropzoneAtCapacity).toBe(false);
  });

  test('without upload rights the dropzone is not the act', () => {
    expect(resolve(preview(), { state: 'survey', canUpload: false }).actOnCard).toBe(false);
  });

  test('waiting on the CLIENT is never actOnCard, dropzone or not', () => {
    expect(resolve(preview(), { state: 'survey', mode: 'blockedClient' }).actOnCard).toBe(
      false,
    );
  });
});

describe('resolveCommandCardCtas — the off-plan toggle', () => {
  test('it is offered at the proposal milestone', () => {
    expect(resolve(preview(), { state: 'created' }).atProposal).toBe(true);
    expect(resolve(preview(), { state: 'design_proposal' }).atProposal).toBe(true);
  });

  test('it is gone past the survey branch', () => {
    expect(resolve(preview(), { state: 'survey' }).atProposal).toBe(false);
    expect(resolve(preview(), { state: 'design_3d' }).atProposal).toBe(false);
  });

  test('a CLOSED engagement never offers it, whatever state it is parked in', () => {
    expect(resolve(preview(), { state: 'created', closed: true }).atProposal).toBe(false);
  });
});

describe('resolveCommandCardCtas while the client owes the review', () => {
  const GATE_A_DUE: EngagementGatePreview['items'][number] = {
    guard: 'gateAInstallmentCleared',
    ok: false,
    code: 'gate_a_not_cleared',
    amountDue: '20000.0000',
  };
  const atConceptReview = preview({ primaryTrigger: 'selectConcept', items: [GATE_A_DUE] });

  test('the money button records only: it never pays AND advances past the review', () => {
    const ctas = resolve(atConceptReview, {
      state: 'concept_review',
      mode: 'blockedClient',
      awaitingClientReview: true,
    });
    expect(ctas.payCta).toBe('recordOnly');
  });

  test('without the wait the same gate pays and advances', () => {
    const ctas = resolve(atConceptReview, { state: 'concept_review', mode: 'blockedClient' });
    expect(ctas.payCta).toBe('payAndAdvance');
  });

  test('the offline approval follows the view', () => {
    expect(resolve(preview(), { offlineApprovalEnabled: true }).offlineApproval).toBe(true);
    expect(resolve(preview(), { offlineApprovalEnabled: false }).offlineApproval).toBe(false);
  });
});
