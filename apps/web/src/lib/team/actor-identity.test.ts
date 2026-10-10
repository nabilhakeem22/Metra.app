import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const admin = vi.hoisted(() => ({ getUserById: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ auth: { admin } }) }));

import { actorIdentityOf, lookupActorIdentity } from './actor-identity';

beforeEach(() => {
  admin.getUserById.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('actorIdentityOf (S1)', () => {
  it('takes the verified email as is and cleans the self-chosen name', () => {
    expect(
      actorIdentityOf({ email: 'sara@studio.test', user_metadata: { full_name: 'Sara\nApproved, no action needed https://x.example' } }),
    ).toEqual({ name: 'Sara Approved, no action needed', email: 'sara@studio.test' });
    expect(actorIdentityOf({ email: 'a@b.test', user_metadata: { full_name: ' ', display_name: 'Ali' } })).toEqual({
      name: 'Ali',
      email: 'a@b.test',
    });
    expect(actorIdentityOf(null)).toEqual({ name: null, email: null });
  });
});

describe('lookupActorIdentity', () => {
  it('asks once per user within the cache window', async () => {
    admin.getUserById.mockResolvedValue({ data: { user: { email: 'sara@studio.test', user_metadata: {} } }, error: null });
    const now = 1_000_000;
    expect(await lookupActorIdentity('u-cache', now)).toEqual({ name: null, email: 'sara@studio.test' });
    await lookupActorIdentity('u-cache', now + 1000);
    expect(admin.getUserById).toHaveBeenCalledTimes(1);
  });

  it('a failed lookup names nobody, is not cached, and never throws', async () => {
    admin.getUserById.mockResolvedValueOnce({ data: { user: null }, error: new Error('down') });
    expect(await lookupActorIdentity('u-fail')).toEqual({ name: null, email: null });
    admin.getUserById.mockResolvedValueOnce({ data: { user: { email: 'x@y.test' } }, error: null });
    expect(await lookupActorIdentity('u-fail')).toEqual({ name: null, email: 'x@y.test' });
  });
});
