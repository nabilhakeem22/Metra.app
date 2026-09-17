import type { VariationStatus } from '@metra/db';
import { describe, expect, it } from 'vitest';
import { variationStatusKey } from './status-label';

const row = (status: VariationStatus, rejectionChannel: string | null = null) => ({
  status,
  rejectionChannel,
});

describe('variationStatusKey', () => {
  it('splits rejected by WHO rejected it', () => {
    // A client refusal is a negotiation signal; a termination cascade is
    // bookkeeping. The register painted both with the same red pill.
    expect(variationStatusKey(row('rejected', 'client'))).toBe('rejected');
    expect(variationStatusKey(row('rejected', 'staff'))).toBe(
      'rejected_on_termination',
    );
  });

  it('keeps the label a pre-0051 row already had', () => {
    expect(variationStatusKey(row('rejected', null))).toBe('rejected');
  });

  it('ignores an unrecognised channel rather than inventing a key', () => {
    expect(variationStatusKey(row('rejected', 'robot'))).toBe('rejected');
  });

  it('never splits a status that is not rejected', () => {
    for (const status of [
      'draft',
      'internal_approved',
      'issued',
      'approved',
    ] as VariationStatus[]) {
      expect(variationStatusKey(row(status, 'staff'))).toBe(status);
      expect(variationStatusKey(row(status, 'client'))).toBe(status);
      expect(variationStatusKey(row(status, null))).toBe(status);
    }
  });
});
