import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it, vi } from 'vitest';
import { mutationFailure } from '@/lib/actions/mutation-failure';
import { underPaymentGuard } from './payment-guard';

vi.mock('server-only', () => ({}));

// A4.1 addendum: the database's own payment guard (MT130 / MT131 / MT132) reads
// as the core's codes, wherever the driver put the SQLSTATE (drizzle wraps it
// one level down, under `cause`).

/** How drizzle >= 0.44 throws a driver error: the SQLSTATE on `cause`. */
const wrapped = (code: string) => new DrizzleQueryError('insert into contract_payments', [], Object.assign(new Error(code), { code }));

async function answerOf(code: string) {
  try {
    await underPaymentGuard(Promise.reject(wrapped(code)), '300.0000');
    return null;
  } catch (error) {
    return mutationFailure(error, {});
  }
}

describe('underPaymentGuard', () => {
  it('says MT130 as request_void, MT132 as request_has_payments', async () => {
    expect(await answerOf('MT130')).toEqual({ ok: false, error: 'request_void' });
    expect(await answerOf('MT132')).toEqual({ ok: false, error: 'request_has_payments' });
  });

  it('says MT131 under the amount, with what the core read as still due', async () => {
    expect(await answerOf('MT131')).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { amount: { code: 'payment_exceeds_request', params: { outstanding: '300.0000' } } },
    });
  });

  it('passes any other failure through untouched, and a write that succeeds through as its value', async () => {
    const other = wrapped('23505');
    await expect(underPaymentGuard(Promise.reject(other), '0')).rejects.toBe(other);
    await expect(underPaymentGuard(Promise.resolve([{ id: 'p-1' }]), '0')).resolves.toEqual([{ id: 'p-1' }]);
  });
});
