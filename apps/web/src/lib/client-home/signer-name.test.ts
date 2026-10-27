import { describe, expect, it } from 'vitest';
import { SIGNER_NAME_MAX, signerNameOf } from './signer-name';

describe('signerNameOf: the name a contract is signed with', () => {
  it('is the typed name on one line, trimmed', () => {
    expect(signerNameOf('  هشام   عادل ')).toBe('هشام عادل');
    expect(signerNameOf('Hesham\nAdel')).toBe('Hesham Adel');
  });

  it('is null for nothing to sign with: empty, spaces, controls only, or not text', () => {
    for (const sent of ['', '   ', '\u0000\t\u200f', null, undefined, 42, { name: 'Hesham' }]) expect(signerNameOf(sent)).toBeNull();
  });

  it('drops bidi overrides and NUL, so the name cannot reverse or cut what the studio reads', () => {
    expect(signerNameOf('\u202eHesham\u0000Adel')).toBe('Hesham Adel');
  });

  it('keeps at most 120 characters, ending in an ellipsis', () => {
    const name = signerNameOf('أ'.repeat(130));
    expect(Array.from(name ?? '')).toHaveLength(SIGNER_NAME_MAX);
    expect(name?.endsWith('…')).toBe(true);
  });
});
