import { describe, expect, it } from 'vitest';
import { claimAdvancesTo } from './claim-advance';
import type { GateChecklistItem } from './gate-preview';

const gateA = (ok: boolean, amountDue: string | null): GateChecklistItem => ({
  guard: 'gateAInstallmentCleared',
  ok,
  code: ok ? null : 'gate_a_not_cleared',
  amountDue,
});
const atConceptReview = (items: GateChecklistItem[]) => ({
  primaryTrigger: 'selectConcept' as const,
  items,
});

describe('claimAdvancesTo', () => {
  it('a full gate_a claim at concept_review moves the delivery to negotiation', () => {
    expect(claimAdvancesTo(atConceptReview([gateA(false, '20000.0000')]), 'gate_a', '20000', true)).toBe(
      'negotiation',
    );
  });

  it('a short amount, another milestone, or a role that cannot advance only records', () => {
    const preview = atConceptReview([gateA(false, '20000.0000')]);
    expect(claimAdvancesTo(preview, 'gate_a', '19999.99', true)).toBeNull();
    expect(claimAdvancesTo(preview, 'balance', '20000', true)).toBeNull();
    expect(claimAdvancesTo(preview, 'gate_a', '20000', false)).toBeNull();
    expect(claimAdvancesTo(preview, 'gate_a', '1,5', true)).toBeNull();
  });

  it('another unmet guard means the confirm only records', () => {
    const preview = {
      primaryTrigger: 'approveDesign' as const,
      items: [
        { guard: 'romAcknowledged' as const, ok: false, code: 'rom_not_acknowledged' as const, amountDue: null },
        { guard: 'gateBInstallmentCleared' as const, ok: false, code: 'gate_b_not_cleared' as const, amountDue: '100.0000' },
      ],
    };
    expect(claimAdvancesTo(preview, 'gate_b', '100', true)).toBeNull();
  });

  it('never at the ending choice (no forward trigger)', () => {
    expect(
      claimAdvancesTo({ primaryTrigger: null, items: [] }, 'balance', '30000', true),
    ).toBeNull();
  });
});
