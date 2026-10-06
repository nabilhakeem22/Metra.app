import { expect, test, vi } from 'vitest';
import { signOutAfterPendingWrites } from './sign-out-after-pending-writes';

const order = vi.hoisted(() => [] as string[]);
vi.mock('@/hooks/pending-removals', () => ({
  flushPendingRemovals: async () => {
    await Promise.resolve();
    order.push('flush settled');
    return true;
  },
}));
vi.mock('@/lib/auth/actions', () => ({
  signOut: async () => {
    order.push('signOut');
  },
}));

test('pending deletes are committed and answered before the session is cleared', async () => {
  await signOutAfterPendingWrites();
  expect(order).toEqual(['flush settled', 'signOut']);
});
