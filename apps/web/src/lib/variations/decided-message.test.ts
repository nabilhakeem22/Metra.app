import { describe, expect, it } from 'vitest';
import {
  variationDecidedKey,
  variationIsDecided,
  type VariationDecisionState,
} from './decided-message';

const state = (over: Partial<VariationDecisionState> = {}): VariationDecisionState => ({
  status: 'issued',
  contractActive: true,
  outcome: null,
  ...over,
});

describe('variationDecidedKey — F6: approved outranks contractInactive', () => {
  it('shows APPROVED for a variation the client approved on a contract later terminated', () => {
    // The bug. Their approval is a fact; "this contract is no longer active" is
    // true of the contract and false about the thing they are looking at, and
    // the page must not appear to deny what they did.
    expect(
      variationDecidedKey(state({ status: 'approved', contractActive: false })),
    ).toBe('approved');
    // Same, immediately after their own click, before any refresh.
    expect(
      variationDecidedKey(state({ outcome: 'approved', contractActive: false })),
    ).toBe('approved');
  });

  it('still shows contractInactive ahead of REJECTED', () => {
    // A terminated contract auto-rejects its open variations, so the row's own
    // status would otherwise tell the client they rejected it themselves.
    expect(
      variationDecidedKey(state({ status: 'rejected', contractActive: false })),
    ).toBe('contractInactive');
    expect(variationDecidedKey(state({ contractActive: false }))).toBe('contractInactive');
    expect(variationDecidedKey(state({ outcome: 'contractInactive' }))).toBe(
      'contractInactive',
    );
  });

  it('shows a genuine rejection while the contract is live', () => {
    expect(variationDecidedKey(state({ status: 'rejected' }))).toBe('rejected');
    expect(variationDecidedKey(state({ outcome: 'rejected' }))).toBe('rejected');
  });

  it('maps the link failures to their own sentences', () => {
    expect(variationDecidedKey(state({ outcome: 'expired' }))).toBe('expired');
    expect(variationDecidedKey(state({ outcome: 'invalid' }))).toBe('invalid');
  });

  it('falls through to already, which is what is left when nothing is named', () => {
    expect(variationDecidedKey(state({ outcome: 'already' }))).toBe('already');
    // An unrecognised status on a live contract with no outcome: the page still
    // has to say SOMETHING, and "you have already responded" is the safe one.
    expect(variationDecidedKey(state({ status: 'superseded' }))).toBe('already');
  });
});

describe('variationIsDecided', () => {
  it('is false only while an issued variation on a live contract awaits a click', () => {
    expect(variationIsDecided(state())).toBe(false);
  });

  it('is true once the contract dies, the status moves, or the client clicks', () => {
    expect(variationIsDecided(state({ contractActive: false }))).toBe(true);
    expect(variationIsDecided(state({ status: 'approved' }))).toBe(true);
    expect(variationIsDecided(state({ outcome: 'invalid' }))).toBe(true);
  });
});
