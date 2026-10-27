import { describe, expect, it } from 'vitest';
import { signsInClientHome } from './home-signing';

// H6.3: a BOQ contract is signed in the client home with a code; a proposal
// contract still signs on its /c link.

describe('signsInClientHome', () => {
  it('is true for a BOQ contract and false for a proposal contract', () => {
    expect(signsInClientHome({ source: 'boq' })).toBe(true);
    expect(signsInClientHome({ source: 'proposal' })).toBe(false);
  });
});
