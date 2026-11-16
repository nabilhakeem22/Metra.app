import { describe, expect, it } from 'vitest';
import { claimsNotYetRead } from './claims-not-yet-read';

// F9: the server is the truth for an instalment once a read shows its claim.

const row = (milestoneKind: string, hasPendingClaim: boolean) => ({ milestoneKind, amountRemaining: '1000.0000', hasPendingClaim, claimedAt: null });

describe('claimsNotYetRead', () => {
  it('drops the claims a read shows pending, and keeps the rest', () => {
    const claimed = new Set(['deposit', 'gate_a']);
    const unread = claimsNotYetRead(claimed, { claimableMilestones: [row('deposit', true), row('gate_a', false)] });
    expect([...unread]).toEqual(['gate_a']);
  });

  it('hands back the same set when a read shows none of them, so a caller can tell nothing changed', () => {
    const claimed = new Set(['deposit']);
    expect(claimsNotYetRead(claimed, { claimableMilestones: [row('deposit', false), row('gate_a', true)] })).toBe(claimed);
    expect(claimsNotYetRead(claimed, { claimableMilestones: [] })).toBe(claimed);
    expect(claimsNotYetRead(claimed, null)).toBe(claimed);
  });
});
