// The fence every internal server action starts behind. Next's `redirect` and
// `notFound` throw in production too, so replacing them with sentinel throws
// tests the real control flow rather than a stand-in for it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const sessionUser = vi.fn<() => Promise<{ id: string } | null>>();
vi.mock('./session', () => ({ getSessionUser: () => sessionUser() }));

interface Membership {
  orgId: string;
  role: string;
  accountId: string | null;
}
const memberships = vi.fn<() => Membership[]>();
vi.mock('@/lib/db/context', () => ({
  withUserContext: async <T>(_userId: string, fn: (tx: unknown) => Promise<T>) =>
    fn({ execute: async () => memberships() }),
}));

const cookieValue = vi.fn<() => string | undefined>();
const deleteCookie = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValue();
      return value ? { name, value } : undefined;
    },
    delete: deleteCookie,
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

import { requireOrg } from './require-org';

const membership = (role: string, orgId = 'org-1'): Membership => ({
  orgId,
  role,
  accountId: 'acc-1',
});

beforeEach(() => {
  sessionUser.mockResolvedValue({ id: 'user-1' });
  memberships.mockReturnValue([membership('owner')]);
  cookieValue.mockReturnValue(undefined);
  deleteCookie.mockClear();
});

describe('requireOrg', () => {
  it('resolves the active org for an internal role', async () => {
    await expect(requireOrg()).resolves.toEqual({
      orgId: 'org-1',
      userId: 'user-1',
      role: 'owner',
      accountId: 'acc-1',
    });
  });

  it('sends an unauthenticated visitor to login, and a memberless one to onboarding', async () => {
    sessionUser.mockResolvedValue(null);
    await expect(requireOrg()).rejects.toThrow('REDIRECT:/login');
    sessionUser.mockResolvedValue({ id: 'user-1' });
    memberships.mockReturnValue([]);
    await expect(requireOrg()).rejects.toThrow('REDIRECT:/onboarding');
  });

  it('REFUSES the client role — it is not an internal role', async () => {
    // The app shell 404s it, but a layout is not a gate: a server action is
    // invokable without one ever rendering. `client` holds `projects: R`, which
    // is enough to mint a signed URL for any project document in the org.
    memberships.mockReturnValue([membership('client')]);
    await expect(requireOrg()).rejects.toThrow('NOT_FOUND');
  });

  it('ignores a client membership rather than letting it shadow an internal one', async () => {
    memberships.mockReturnValue([membership('client', 'org-client'), membership('viewer')]);
    await expect(requireOrg()).resolves.toMatchObject({
      orgId: 'org-1',
      role: 'viewer',
    });
  });

  it('will not honour a cookie pointing at a client membership', async () => {
    memberships.mockReturnValue([membership('viewer'), membership('client', 'org-client')]);
    cookieValue.mockReturnValue('org-client');
    await expect(requireOrg()).resolves.toMatchObject({
      orgId: 'org-1',
      role: 'viewer',
    });
    expect(deleteCookie).toHaveBeenCalled();
  });

  it('honours a cookie naming a real internal membership', async () => {
    memberships.mockReturnValue([membership('owner'), membership('accountant', 'org-2')]);
    cookieValue.mockReturnValue('org-2');
    await expect(requireOrg()).resolves.toMatchObject({
      orgId: 'org-2',
      role: 'accountant',
    });
    expect(deleteCookie).not.toHaveBeenCalled();
  });
});
