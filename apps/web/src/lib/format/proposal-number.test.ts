import { describe, expect, it } from 'vitest';
import { formatProposalNumber, proposalYear } from './proposal-number';

describe('formatProposalNumber', () => {
  it('formats Q-YYYY-NNNN with zero padding', () => {
    expect(formatProposalNumber(1, 2026)).toBe('Q-2026-0001');
    expect(formatProposalNumber(42, 2027)).toBe('Q-2027-0042');
    expect(formatProposalNumber(12345, 2026)).toBe('Q-2026-12345');
  });
});

describe('proposalYear', () => {
  it('prefers the issue date year, else createdAt', () => {
    expect(proposalYear('2027-03-01', '2026-01-01')).toBe(2027);
    expect(proposalYear(null, '2026-01-01T00:00:00Z')).toBe(2026);
  });
});
