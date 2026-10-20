import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPaymentAttempt,
  mayStillBeRunning,
  PAYMENT_WRITE_WINDOW_MS,
  paymentActOf,
  paymentAttemptStorageKey,
  readPaymentAttempt,
  writePaymentAttempt,
} from './payment-attempt-store';

// A4 F1: the record dialog's held key, stored per contract and request. A node
// test: the module touches sessionStorage and nothing else, so a Map double
// stands in for it (the cockpit's held-keys-store.test.ts does the same).

const KEY = '6f9619ff-8b86-4011-b42d-00c04fc964ff';
const PAYMENT = { amount: '5000.0000', receivedOn: '2026-10-20', method: null, reference: null, note: null };
const store = new Map<string, string>();
const storage = {
  getItem: (name: string) => store.get(name) ?? null,
  setItem: (name: string, value: string) => void store.set(name, value),
  removeItem: (name: string) => void store.delete(name),
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal('sessionStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

describe('the held payment attempt', () => {
  it('is kept per contract and request, and cleared', () => {
    const attempt = { key: KEY, act: paymentActOf('r-1', PAYMENT), sentAt: 1_700_000_000_000 };
    writePaymentAttempt('c-1', 'r-1', attempt);
    expect(readPaymentAttempt('c-1', 'r-1')).toEqual(attempt);
    expect(readPaymentAttempt('c-1', 'r-2')).toBeNull();
    expect(readPaymentAttempt('c-2', 'r-1')).toBeNull();
    clearPaymentAttempt('c-1', 'r-1');
    expect(readPaymentAttempt('c-1', 'r-1')).toBeNull();
  });

  it('names the act by every value, canonical, and never keeps the amount in the clear', () => {
    const act = paymentActOf('r-1', PAYMENT);
    expect(act).toBe(paymentActOf('r-1', { ...PAYMENT }));
    expect(act).not.toBe(paymentActOf('r-1', { ...PAYMENT, amount: '5000.0001' }));
    expect(act).not.toBe(paymentActOf('r-2', PAYMENT));
    expect(act).not.toBe(paymentActOf('r-1', { ...PAYMENT, reference: 'TX-2' }));
    writePaymentAttempt('c-1', 'r-1', { key: KEY, act, sentAt: 1 });
    expect(store.get(paymentAttemptStorageKey('c-1', 'r-1'))).not.toContain('5000');
  });

  it('drops, and erases, an entry that is not a uuid key, an act hash and an instant: it would be sent to the server', () => {
    for (const poisoned of [
      '{"key":"not-a-uuid","act":"0123456789abcdef","sentAt":1}',
      `{"key":"${KEY}","act":"x","sentAt":1}`,
      `{"key":"${KEY}","act":"0123456789abcdef"}`,
      `{"key":"${KEY}","act":"0123456789abcdef","sentAt":"soon"}`,
      '[1]',
      'nonsense',
    ]) {
      store.set(paymentAttemptStorageKey('c-1', 'r-1'), poisoned);
      expect(readPaymentAttempt('c-1', 'r-1'), poisoned).toBeNull();
    }
    store.set(paymentAttemptStorageKey('c-1', 'r-1'), '{"key":"not-a-uuid","act":"0123456789abcdef"}');
    readPaymentAttempt('c-1', 'r-1');
    expect(store.has(paymentAttemptStorageKey('c-1', 'r-1'))).toBe(false);
  });

  it('a storage that throws on access changes nothing else', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(readPaymentAttempt('c-1', 'r-1')).toBeNull();
    expect(() => writePaymentAttempt('c-1', 'r-1', { key: KEY, act: '0123456789abcdef', sentAt: 1 })).not.toThrow();
    expect(() => clearPaymentAttempt('c-1', 'r-1')).not.toThrow();
  });

  it('a sent attempt may still be running for the server write window (lock_timeout 5 s + the 15 s deadline), then no longer (N1)', () => {
    const attempt = { key: KEY, act: '0123456789abcdef', sentAt: 1_000_000 };
    expect(PAYMENT_WRITE_WINDOW_MS).toBe(20_000);
    expect(mayStillBeRunning(attempt, 1_000_000)).toBe(true);
    expect(mayStillBeRunning(attempt, 1_000_000 + 19_999)).toBe(true);
    expect(mayStillBeRunning(attempt, 1_000_000 + 20_000)).toBe(false);
  });
});
