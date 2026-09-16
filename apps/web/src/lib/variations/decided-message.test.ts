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
  // The LEGACY shape by default: every event written before 0051 has no channel,
  // and there is no backfill. Every case below that does not say otherwise is
  // therefore asserting that a pre-0051 row reads exactly as it does on main.
  rejectionChannel: null,
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

  it('still shows contractInactive ahead of an UNRECORDED rejection', () => {
    // A terminated contract auto-rejects its open variations, so a row whose
    // channel was never recorded would otherwise tell the client they rejected
    // it themselves. This is rule 6 of the ladder and the reason it survives:
    // the wording of every pre-0051 row is unchanged.
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

// A10 / 0051 — THE TABLE IS THE TEST. Eight rows, one per combination the ladder
// distinguishes, with the wave-2 F6 behaviour preserved in rows 7 and 8.
describe('variationDecidedKey — A10: who rejected it is READ, not guessed', () => {
  it('1. a live contract, the client just clicked reject -> rejected (unchanged)', () => {
    expect(variationDecidedKey(state({ outcome: 'rejected' }))).toBe('rejected');
  });

  it('2. client-rejected, contract still live -> rejected (unchanged)', () => {
    expect(
      variationDecidedKey(state({ status: 'rejected', rejectionChannel: 'client' })),
    ).toBe('rejected');
  });

  it('3. FIXED: client-rejected, contract terminated AFTERWARDS -> rejected', () => {
    // THE DEFECT. The client refused this variation order and the studio then
    // terminated the contract; the portal answered "this contract is no longer
    // in force", denying a decision the client had made and the ledger had
    // recorded. It now reads their own refusal back to them.
    expect(
      variationDecidedKey(
        state({ status: 'rejected', contractActive: false, rejectionChannel: 'client' }),
      ),
    ).toBe('rejected');
  });

  it('4. NEW: the termination cascade closed it -> rejectedOnTermination', () => {
    // The client never touched this one. "You rejected it" would be a lie and
    // "the contract is no longer active" does not say what happened to THIS
    // document, so it gets a sentence of its own.
    expect(
      variationDecidedKey(
        state({ status: 'rejected', contractActive: false, rejectionChannel: 'staff' }),
      ),
    ).toBe('rejectedOnTermination');
    // And on a contract that is somehow still live, the cascade stamp still wins:
    // the channel is a recorded fact, the contract status is an inference.
    expect(
      variationDecidedKey(state({ status: 'rejected', rejectionChannel: 'staff' })),
    ).toBe('rejectedOnTermination');
  });

  it('5. LEGACY, terminated contract, no channel -> contractInactive (unchanged)', () => {
    expect(
      variationDecidedKey(state({ status: 'rejected', contractActive: false })),
    ).toBe('contractInactive');
  });

  it('6. LEGACY, live contract, no channel -> rejected (unchanged)', () => {
    expect(variationDecidedKey(state({ status: 'rejected' }))).toBe('rejected');
  });

  it('7. issued on a terminated contract -> contractInactive (unchanged)', () => {
    expect(variationDecidedKey(state({ contractActive: false }))).toBe(
      'contractInactive',
    );
  });

  it('8. approved on a terminated contract -> approved (wave-2 F6 preserved)', () => {
    expect(
      variationDecidedKey(state({ status: 'approved', contractActive: false })),
    ).toBe('approved');
    expect(
      variationDecidedKey(
        state({ status: 'approved', contractActive: false, rejectionChannel: 'staff' }),
      ),
    ).toBe('approved');
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
