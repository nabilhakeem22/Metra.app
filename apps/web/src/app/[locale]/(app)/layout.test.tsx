import { isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import AppLayout from './layout';

vi.mock('server-only', () => ({}));
vi.mock('@/components/shell/app-shell', () => ({ AppShell: () => null }));
vi.mock('@/lib/auth/require-org', () => ({
  requireOrg: async () => ({ orgId: 'o-1', userId: 'u-1', role: 'owner' }),
}));
vi.mock('@/lib/auth/session', () => ({
  getSessionUser: async () => ({ email: 'studio@example.com', user_metadata: {} }),
}));
vi.mock('@/lib/org/queries', () => ({ listCurrentUserOrgs: async () => [] }));
const bell = vi.hoisted(() => ({ countUnread: vi.fn(), listNotifications: vi.fn() }));
vi.mock('@/lib/notifications/queries', () => bell);

afterEach(() => vi.restoreAllMocks());

async function shellProps(): Promise<Record<string, unknown>> {
  const element = await AppLayout({ children: null });
  expect(isValidElement(element)).toBe(true);
  return (element as ReactElement<Record<string, unknown>>).props;
}

describe('AppLayout: the bell never takes the shell down (R6)', () => {
  test('both notification reads failing: the shell renders with an empty bell', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bell.countUnread.mockRejectedValue(new Error('db down'));
    bell.listNotifications.mockRejectedValue(new Error('db down'));
    const props = await shellProps();
    expect(props.unreadCount).toBe(0);
    expect(props.notifications).toEqual([]);
    expect(props.email).toBe('studio@example.com');
  });

  test('one read failing keeps the other', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    bell.countUnread.mockResolvedValue(3);
    bell.listNotifications.mockRejectedValue(new Error('db down'));
    const props = await shellProps();
    expect(props.unreadCount).toBe(3);
    expect(props.notifications).toEqual([]);
  });
});
