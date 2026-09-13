import { CONTRACT_STATUSES, VARIATION_STATUSES } from '@metra/db';
import { describe, expect, it } from 'vitest';
import {
  canInternalApproveVariation,
  canIssueVariation,
  isContractActive,
  variationsToRejectOnTermination,
} from './lifecycle-rules';

describe('isContractActive', () => {
  it('is true only for issued and signed', () => {
    expect(CONTRACT_STATUSES.filter(isContractActive)).toEqual([
      'issued',
      'signed',
    ]);
  });
});

describe('canInternalApproveVariation', () => {
  // Every cell of the 5 variation statuses x 4 contract statuses grid.
  for (const voStatus of VARIATION_STATUSES) {
    for (const contractStatus of CONTRACT_STATUSES) {
      const expected =
        voStatus === 'draft' &&
        (contractStatus === 'issued' || contractStatus === 'signed');
      it(`${voStatus} under ${contractStatus} contract -> ${expected}`, () => {
        expect(canInternalApproveVariation(voStatus, contractStatus)).toBe(
          expected,
        );
      });
    }
  }
});

describe('canIssueVariation', () => {
  for (const voStatus of VARIATION_STATUSES) {
    for (const contractStatus of CONTRACT_STATUSES) {
      const expected =
        voStatus === 'internal_approved' &&
        (contractStatus === 'issued' || contractStatus === 'signed');
      it(`${voStatus} under ${contractStatus} contract -> ${expected}`, () => {
        expect(canIssueVariation(voStatus, contractStatus)).toBe(expected);
      });
    }
  }
});

describe('variationsToRejectOnTermination', () => {
  it('closes out only the undecided statuses', () => {
    expect(VARIATION_STATUSES.filter(variationsToRejectOnTermination)).toEqual([
      'draft',
      'internal_approved',
      'issued',
    ]);
  });

  it('leaves an already decided variation alone', () => {
    expect(variationsToRejectOnTermination('approved')).toBe(false);
    expect(variationsToRejectOnTermination('rejected')).toBe(false);
  });
});
