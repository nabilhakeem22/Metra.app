// The automation tick's address book: one admin-API call per user per tick, a
// deadline on every call, and nothing personal in the log when it goes wrong.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getUserById = vi.fn();
const createSupabaseAdminClient = vi.fn(() => ({ auth: { admin: { getUserById } } }));
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClient(),
}));

import { AUTH_LOOKUP_TIMEOUT_MS } from '@/lib/http/deadlines';
import { createRecipientEmailLookup } from './recipients';

const OWNER = '6f1c2a0e-1111-4c2b-9a51-000000000001';
const ADMIN = '6f1c2a0e-1111-4c2b-9a51-000000000002';
const EMAIL = 'owner@studio.example';

function userWithEmail(email: string | undefined) {
  return { data: { user: { id: OWNER, email } }, error: null };
}

/** Every argument any console.error call received, flattened to text. */
function loggedText(): string {
  return JSON.stringify(vi.mocked(console.error).mock.calls);
}

beforeEach(() => {
  getUserById.mockReset();
  createSupabaseAdminClient.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createRecipientEmailLookup', () => {
  it('finds an address, and says so when the user has none', async () => {
    getUserById.mockImplementation(async (id: string) =>
      userWithEmail(id === OWNER ? EMAIL : undefined),
    );
    const lookup = createRecipientEmailLookup();
    await expect(lookup(OWNER)).resolves.toEqual({ status: 'found', email: EMAIL });
    await expect(lookup(ADMIN)).resolves.toEqual({ status: 'no-address' });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('asks the admin API once per user per tick, concurrent callers included', async () => {
    getUserById.mockResolvedValue(userWithEmail(EMAIL));
    const lookup = createRecipientEmailLookup();
    await Promise.all([lookup(OWNER), lookup(OWNER), lookup(ADMIN)]);
    await lookup(OWNER);
    expect(getUserById).toHaveBeenCalledTimes(2);

    // A new tick starts with an empty cache: nothing survives the request.
    await createRecipientEmailLookup()(OWNER);
    expect(getUserById).toHaveBeenCalledTimes(3);
  });

  it('gives up on a hung auth origin at the deadline, once for the whole tick', async () => {
    vi.useFakeTimers();
    getUserById.mockReturnValue(new Promise(() => {}));
    const lookup = createRecipientEmailLookup();
    const first = lookup(OWNER);
    await vi.advanceTimersByTimeAsync(AUTH_LOOKUP_TIMEOUT_MS - 1);
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toEqual({ status: 'failed' });
    // The second core asking for the same user does not wait another 8 s.
    await expect(lookup(OWNER)).resolves.toEqual({ status: 'failed' });
    expect(getUserById).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      'automation recipient lookup failed:',
      expect.objectContaining({ name: 'HttpDeadlineError' }),
    );
  });

  it('treats an auth error or a missing key as failed, and logs no id or address', async () => {
    getUserById.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthApiError', code: 'user_not_found', message: 'User not found' },
    });
    await expect(createRecipientEmailLookup()(OWNER)).resolves.toEqual({ status: 'failed' });

    createSupabaseAdminClient.mockImplementationOnce(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    });
    await expect(createRecipientEmailLookup()(ADMIN)).resolves.toEqual({ status: 'failed' });

    expect(console.error).toHaveBeenCalledTimes(2);
    expect(loggedText()).not.toContain(OWNER);
    expect(loggedText()).not.toContain(ADMIN);
    expect(loggedText()).not.toContain('@');
  });
});
