import { flushPendingRemovals } from '@/hooks/pending-removals';
import { signOut } from '@/lib/auth/actions';

/**
 * The sign-out form's action. A delete still waiting on its Undo toast is
 * committed, and its answer awaited, BEFORE the session is cleared: flushed
 * afterwards it would reach the server with no session and be refused.
 */
export async function signOutAfterPendingWrites(): Promise<void> {
  await flushPendingRemovals();
  await signOut();
}
