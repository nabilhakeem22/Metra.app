import { describe, expect, test } from 'vitest';
import { resolveCommandCardCtas } from './command-card-ctas';
import type { EngagementGatePreview } from './gate-preview';
import { CONCEPT_OPTION_MAX } from './concept-options';

function preview(
  overrides: Partial<EngagementGatePreview> = {},
): EngagementGatePreview {
  return { primaryTrigger: 'confirmAndPayDeposit', items: [], allClear: false, ...overrides };
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
};

const resolve = (
  gate: EngagementGatePreview,
  options: Partial<CtaOptions> = {},
) => resolveCommandCardCtas(gate, { ...BASE, ...options });

describe('resolveCommandCardCtas — the pay-and-advance path', () => {
  test('a blocking money gate with a shortfall offers the pay CTA and its kind', () => {
    const ctas = resolve(preview({ items: [DEPOSIT_DUE] }));
    expect(ctas.showPayCta).toBe(true);
    expect(ctas.paymentKind).toBe('deposit');
    expect(ctas.paymentItem?.amountDue).toBe('25000.0000');
  });

  test('an unmet NON-money guard is not a payment gate', () => {
    const ctas = resolve(preview({ items: [NON_MONEY_UNMET] }));
    expect(ctas.showPayCta).toBe(false);
    expect(ctas.paymentItem).toBeUndefined();
  });

  test('a money guard that is already OK offers nothing', () => {
    const ctas = resolve(preview({ items: [{ ...DEPOSIT_DUE, ok: true }] }));
    expect(ctas.showPayCta).toBe(false);
  });

  test('a money guard with NO amountDue offers nothing — there is nothing to pre-fill', () => {
    const ctas = resolve(preview({ items: [{ ...DEPOSIT_DUE, amountDue: null }] }));
    expect(ctas.showPayCta).toBe(false);
  });

  test('without the finance capability the CTA is withheld, but the item is still found', () => {
    const ctas = resolve(preview({ items: [DEPOSIT_DUE] }), { canRecordPayment: false });
    expect(ctas.showPayCta).toBe(false);
    expect(ctas.paymentItem).toBeDefined();
  });

  test('without canAdvance the pay-AND-ADVANCE CTA is withheld', () => {
    expect(resolve(preview({ items: [DEPOSIT_DUE] }), { canAdvance: false }).showPayCta).toBe(
      false,
    );
  });

  test('with no forward trigger there is nothing to advance to', () => {
    const ctas = resolve(preview({ items: [DEPOSIT_DUE], primaryTrigger: null }));
    expect(ctas.showPayCta).toBe(false);
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
