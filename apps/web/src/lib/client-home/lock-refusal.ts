import 'server-only';
// A code request or a code-checked act that the DATABASE refused for a lock
// (H5 reliability R3, R4). Each runs ONE token function in one statement, so a
// lock wait that gave up (55P03) or a deadlock that chose it (40P01, beside
// an apply-rls) rolled that statement back whole: nothing was written, no code
// was made, used or tried. That is `busy` (ask again in a moment), never the
// "could not confirm, refresh and check" a lost write gets. The functions
// answer `busy` themselves on a lock wait; this catches what reaches the app
// anyway. One redacted line each, so a run of them is visible at 3 a.m.
import { sqlstateOf } from '@metra/db/sqlstate';
import { loggableFailure } from '@/lib/actions/loggable-failure';

/** lock_not_available and deadlock_detected: the statement was rolled back. */
const LOCK_REFUSALS: ReadonlySet<string> = new Set(['55P03', '40P01']);

/** Run `call`; a lock refusal from the database answers `busy` instead of throwing. */
export async function busyOnLockRefusal<T, B>(act: string, busy: B, call: () => Promise<T>): Promise<T | B> {
  try {
    return await call();
  } catch (error) {
    const code = sqlstateOf(error);
    if (code === undefined || !LOCK_REFUSALS.has(code)) throw error;
    console.warn('client code act busy', { act, failure: loggableFailure(error) });
    return busy;
  }
}
