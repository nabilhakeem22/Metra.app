import { describe, expect, it } from 'vitest';
import { canonicalIdempotencyKey } from './idempotency-key';

// A4 S2: a ledger compares its keys lower-case.

describe('canonicalIdempotencyKey', () => {
  it('trims and lower-cases, and reads anything but a string as no key', () => {
    expect(canonicalIdempotencyKey('  6F9619FF-8B86-D011-B42D-00C04FC964FF ')).toBe('6f9619ff-8b86-d011-b42d-00c04fc964ff');
    for (const raw of [undefined, null, 42, ['k'], { key: 'k' }]) expect(canonicalIdempotencyKey(raw)).toBe('');
  });
});
