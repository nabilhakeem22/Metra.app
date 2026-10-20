// The database half of the payment invariant (rls/functions/35-execution.sql,
// A2 reliability R2) raises three SQLSTATEs of its own. The cores refuse the
// same things first, under the request's row lock, so these only fire for a
// writer the core did not see; when they do, the studio reads the core's own
// sentence, never a "something went wrong" (plan A4.1 addendum):
//   MT130 `request_void`            a payment on a request that is not issued;
//   MT131 `payment_exceeds_request` a payment past the request's amount, said
//                                   under `amount` with what is still due;
//   MT132 `request_has_payments`    a void of a request that has a payment.
// PURE: it reads the error's SQLSTATE wherever the driver put it.
import { sqlstateOf } from '@metra/db/sqlstate';
import { failFields } from '@/lib/actions/field-errors';
import { fail } from '@/lib/actions/result';

/**
 * Run one write of the payment ledger or of a request's void, and turn a guard
 * refusal into the core's code. `outstanding` is what the core read as still
 * due under its lock: the figure said under the amount on MT131.
 */
export async function underPaymentGuard<T>(write: PromiseLike<T>, outstanding: string): Promise<T> {
  try {
    return await write;
  } catch (error) {
    const code = sqlstateOf(error);
    if (code === 'MT130') fail('request_void');
    if (code === 'MT131') failFields({ amount: { code: 'payment_exceeds_request', params: { outstanding } } });
    if (code === 'MT132') fail('request_has_payments');
    throw error;
  }
}
