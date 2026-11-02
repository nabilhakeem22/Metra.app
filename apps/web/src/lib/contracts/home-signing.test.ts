import { describe, expect, it } from 'vitest';
import { isOpenForSigning, signsInClientHome } from './home-signing';

// H6.3: a BOQ contract is signed in the client home with a code; a proposal
// contract still signs on its /c link.

describe('signsInClientHome', () => {
  it('is true for a BOQ contract and false for a proposal contract', () => {
    expect(signsInClientHome({ source: 'boq' })).toBe(true);
    expect(signsInClientHome({ source: 'proposal' })).toBe(false);
  });
});

describe('isOpenForSigning: the SQL signing_open rule', () => {
  const NOW = Date.parse('2026-11-02T10:00:00.000Z');

  it.each([
    ['issued, the window ahead', 'issued', '2026-11-02T10:00:00.001Z', true],
    ['issued, no end date', 'issued', null, true],
    ['issued, the window ends now', 'issued', '2026-11-02T10:00:00.000Z', false],
    ['issued, the window behind', 'issued', '2026-11-01T10:00:00.000Z', false],
    ['signed, the window ahead', 'signed', '2026-11-03T10:00:00.000Z', false],
  ])('%s', (_case, status, share_expires_at, expected) => {
    expect(isOpenForSigning({ status, share_expires_at }, NOW)).toBe(expected);
  });
});
