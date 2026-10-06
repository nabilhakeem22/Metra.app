import { flushPendingRemovals } from '@/hooks/pending-removals';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { signOut } from '@/lib/auth/actions';

/** How long sign-out waits for pending deletes before clearing the session anyway. */
export const SIGN_OUT_FLUSH_TIMEOUT_MS = 5000;

/**
 * The sign-out form's action. A delete still waiting on its Undo toast is
 * committed, and its answer awaited, BEFORE the session is cleared: flushed
 * afterwards it would reach the server with no session and be refused.
 *
 * The flush is best effort and the sign-out is not: a delete that never
 * answers, or a flush that throws, must not leave a session open on a shared
 * machine. So the wait is capped and the session is cleared whatever happens.
 */
export async function signOutAfterPendingWrites(): Promise<void> {
  let cap: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      flushPendingRemovals(),
      new Promise<void>((resolve) => {
        cap = setTimeout(resolve, SIGN_OUT_FLUSH_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.error('sign-out: pending deletes could not be flushed', loggableFailure(error));
  } finally {
    clearTimeout(cap);
    await signOut();
  }
}
