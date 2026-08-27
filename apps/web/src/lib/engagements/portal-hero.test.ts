import { describe, expect, it } from 'vitest';
import {
  CLIENT_ACTION_VERBS,
  deriveHero,
  paymentGlance,
} from './portal-hero';
import type { PublicDeliveryMilestone } from './public';

function milestone(
  milestone_kind: string,
  status: PublicDeliveryMilestone['status'],
  amount_due = '10000.0000',
): PublicDeliveryMilestone {
  return { milestone_kind, basis: 'x', amount_due, amount_cleared: '0', status };
}

describe('CLIENT_ACTION_VERBS', () => {
  it('is exactly the six client-facing verbs', () => {
    expect([...CLIENT_ACTION_VERBS].sort()).toEqual(
      [
        'acknowledge_handoff',
        'acknowledge_rom',
        'approve_concept',
        'approve_design',
        'request_concept_changes',
        'request_design_changes',
      ].sort(),
    );
  });
});

describe('deriveHero', () => {
  it('offers the concept group for concept verbs', () => {
    const hero = deriveHero(['approve_concept', 'request_concept_changes'], 'concept_review');
    expect(hero).toEqual({ kind: 'action', group: 'concept', showRomAck: false });
  });

  it('offers the design group for design verbs', () => {
    const hero = deriveHero(['approve_design', 'request_design_changes'], 'final_approval');
    expect(hero).toEqual({ kind: 'action', group: 'design', showRomAck: false });
  });

  it('offers the handoff group for the handoff verb', () => {
    const hero = deriveHero(['acknowledge_handoff'], 'design_only_handoff');
    expect(hero).toEqual({ kind: 'action', group: 'handoff', showRomAck: false });
  });

  it('applies precedence design > concept > handoff', () => {
    const hero = deriveHero(
      ['acknowledge_handoff', 'approve_concept', 'approve_design'],
      'final_approval',
    );
    expect(hero.group).toBe('design');
  });

  it('prefers concept over handoff when no design verb is present', () => {
    const hero = deriveHero(['acknowledge_handoff', 'approve_concept'], 'concept_review');
    expect(hero.group).toBe('concept');
  });

  it('surfaces acknowledge_rom as a subordinate flag, never the hero', () => {
    const hero = deriveHero(['approve_concept', 'acknowledge_rom'], 'concept_review');
    expect(hero.group).toBe('concept');
    expect(hero.showRomAck).toBe(true);
  });

  it('does NOT let acknowledge_rom alone become an action hero', () => {
    const hero = deriveHero(['acknowledge_rom'], 'design_3d');
    expect(hero.kind).toBe('inProgress');
    expect(hero.group).toBeUndefined();
    expect(hero.showRomAck).toBe(true);
  });

  it('is delivered for the two terminal delivered states', () => {
    expect(deriveHero([], 'closed_design_only').kind).toBe('delivered');
    expect(deriveHero([], 'execution').kind).toBe('delivered');
  });

  it('is closed for abandoned', () => {
    expect(deriveHero([], 'abandoned').kind).toBe('closed');
  });

  it('is a calm inProgress for an active state with no actions', () => {
    expect(deriveHero([], 'design_3d').kind).toBe('inProgress');
  });

  it('ignores unknown verbs', () => {
    const hero = deriveHero(['delete_everything', 'approve_concept'], 'concept_review');
    expect(hero.group).toBe('concept');
  });
});

describe('paymentGlance', () => {
  it('reports an empty schedule as nothing due, not settled', () => {
    expect(paymentGlance([])).toEqual({ depositPaid: false, nextDue: null, allSettled: false });
  });

  it('flags a paid deposit and the next unsettled milestone', () => {
    const glance = paymentGlance([
      milestone('deposit', 'paid'),
      milestone('gate_a', 'due', '20000.0000'),
      milestone('balance', 'due', '5000.0000'),
    ]);
    expect(glance.depositPaid).toBe(true);
    expect(glance.nextDue).toEqual({ milestone_kind: 'gate_a', amount_due: '20000.0000' });
    expect(glance.allSettled).toBe(false);
  });

  it('treats a partial milestone as the next due', () => {
    const glance = paymentGlance([
      milestone('deposit', 'paid'),
      milestone('gate_a', 'partial', '15000.0000'),
    ]);
    expect(glance.nextDue?.milestone_kind).toBe('gate_a');
  });

  it('reports allSettled when every milestone is paid', () => {
    const glance = paymentGlance([milestone('deposit', 'paid'), milestone('balance', 'paid')]);
    expect(glance.allSettled).toBe(true);
    expect(glance.nextDue).toBeNull();
  });
});
