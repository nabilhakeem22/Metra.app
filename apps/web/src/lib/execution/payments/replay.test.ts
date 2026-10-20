import { describe, expect, it } from 'vitest';
import { canonicalIdempotencyKey, isSamePayment } from './replay';

// A4 F4, S2: a replayed key is the same payment only on the same request with
// the same amount; the key is compared lower-case.

const STORED = { id: 'p-1', requestId: 'r-1', amount: '5000.0000' };

describe('isSamePayment', () => {
  it('is the same payment on the same request with the same amount, however the amount is written', () => {
    expect(isSamePayment(STORED, { requestId: 'r-1', amount: '5000.0000' })).toBe(true);
    expect(isSamePayment(STORED, { requestId: 'r-1', amount: '5000' })).toBe(true);
  });

  it('is a different payment on another request, or of another amount', () => {
    expect(isSamePayment(STORED, { requestId: 'r-2', amount: '5000.0000' })).toBe(false);
    expect(isSamePayment(STORED, { requestId: 'r-1', amount: '5000.0001' })).toBe(false);
    expect(isSamePayment(STORED, { requestId: 'r-1', amount: '999.0000' })).toBe(false);
  });
});

describe('canonicalIdempotencyKey', () => {
  it('trims and lower-cases, and reads anything but a string as no key', () => {
    expect(canonicalIdempotencyKey('  6F9619FF-8B86-D011-B42D-00C04FC964FF ')).toBe('6f9619ff-8b86-d011-b42d-00c04fc964ff');
    for (const raw of [undefined, null, 42, ['k'], { key: 'k' }]) expect(canonicalIdempotencyKey(raw)).toBe('');
  });
});
