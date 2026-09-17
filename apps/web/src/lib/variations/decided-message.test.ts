import { describe, expect, it } from 'vitest';
import {
  variationDecidedKey,
  variationIsDecided,
  type VariationDecidedKey,
  type VariationDecisionState,
  type VariationOutcome,
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

// A2 IS A PROPERTY, NOT AN ANECDOTE: a row with no recorded channel — which is
// EVERY row written before 0051, and there is no backfill — must render exactly
// what it renders on main.
//
// The functional tester proved that claim false by executing this sweep against
// the first version of the ladder: 5 divergences out of 84, all of the shape
// `status=*, outcome=rejected, contractActive=false`, where the new ladder said
// `rejected` and main says `contractInactive`. It was unreachable through the
// only caller (`respond()` cannot set `outcome` on a dead contract, because the
// buttons live in the `decided ? … : …` else-branch and `variationIsDecided` is
// true whenever the contract is dead) — so the screen was right and the pure
// function's stated contract was not. This is the assertion that would have
// caught it.
describe('A2: a NULL channel renders EXACTLY what main renders', () => {
  /**
   * `git show main:apps/web/src/lib/variations/decided-message.ts`, verbatim.
   * Copied rather than imported because the point is to compare against code
   * that no longer exists in the tree; if the ladder above is ever re-ordered,
   * this copy does not move with it.
   */
  function mainLadder(
    status: string,
    contractActive: boolean,
    outcome: VariationOutcome,
  ): VariationDecidedKey {
    if (outcome === 'approved' || status === 'approved') return 'approved';
    if (!contractActive || outcome === 'contractInactive') return 'contractInactive';
    if (outcome === 'rejected' || status === 'rejected') return 'rejected';
    if (outcome === 'expired') return 'expired';
    if (outcome === 'invalid') return 'invalid';
    return 'already';
  }

  const STATUSES = ['draft', 'internal_approved', 'issued', 'rejected', 'approved', 'expired'];
  const OUTCOMES: VariationOutcome[] = [
    'approved',
    'rejected',
    'expired',
    'invalid',
    'contractInactive',
    'already',
    null,
  ];

  it('agrees with main on all 84 null-channel combinations', () => {
    const divergences: string[] = [];
    let compared = 0;
    for (const status of STATUSES) {
      for (const outcome of OUTCOMES) {
        for (const contractActive of [true, false]) {
          compared += 1;
          const now = variationDecidedKey({
            status,
            contractActive,
            outcome,
            rejectionChannel: null,
          });
          const before = mainLadder(status, contractActive, outcome);
          if (now !== before) {
            divergences.push(
              `status=${status} outcome=${String(outcome)} active=${contractActive}: ` +
                `main=${before} new=${now}`,
            );
          }
        }
      }
    }
    // Not vacuous: 6 statuses x 7 outcomes x 2 contract states.
    expect(compared).toBe(84);
    expect(divergences).toEqual([]);
  });

  it('and a RECORDED channel is the only thing that changes an answer', () => {
    // The mirror: every combination where the new ladder is ALLOWED to differ
    // carries a channel, and no pre-0051 row has one.
    const changed: string[] = [];
    for (const status of STATUSES) {
      for (const outcome of OUTCOMES) {
        for (const contractActive of [true, false]) {
          for (const rejectionChannel of ['client', 'staff'] as const) {
            const now = variationDecidedKey({
              status,
              contractActive,
              outcome,
              rejectionChannel,
            });
            if (now !== mainLadder(status, contractActive, outcome)) {
              changed.push(`${status}/${String(outcome)}/${contractActive}/${rejectionChannel}`);
            }
          }
        }
      }
    }
    // Every difference is a `rejected` row: the channel is read off the
    // rejection event, so it can only re-describe a rejection.
    expect(changed.every((c) => c.startsWith('rejected/'))).toBe(true);
    expect(changed.length).toBeGreaterThan(0);
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
