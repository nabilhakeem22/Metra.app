import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render-with-intl';
import { NotificationBell } from '@/components/shell/notification-bell';
import type { FeedItem, NotificationFeed } from './feed-item';
import { NotificationsClient } from '@/app/[locale]/(app)/notifications/notifications-client';
import { NotificationFeedProvider } from './notification-feed-context';
import {
  NOTIFICATION_POLL_MS,
  RETURN_POLL_MIN_GAP_MS,
  useNotificationFeed,
} from './use-notification-feed';

const actions = vi.hoisted(() => ({
  pollNotificationFeed: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock('@/lib/notifications/actions', () => actions);
const toasts = vi.hoisted(() => [] as { title?: string }[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: { title?: string }) => {
    toasts.push(raised);
  },
}));

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

const item = (id: string, read = false): FeedItem => ({
  id,
  kind: 'client_responded',
  bodyKey: 'client_commented',
  params: { number: 1, year: 2026, titleEn: 'Kitchen', count: 1 },
  entityType: 'engagement',
  entityId: 'e-1',
  createdAt: '2026-10-07T10:00:00.000Z',
  read,
});

const FEED: NotificationFeed = { unreadCount: 1, items: [item('a')] };

let latest: ReturnType<typeof useNotificationFeed> | null = null;
function Probe({ feed }: { feed: NotificationFeed }) {
  latest = useNotificationFeed(feed);
  return <output>{latest.unreadCount}</output>;
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  actions.pollNotificationFeed.mockResolvedValue({ ok: true, data: FEED });
  actions.markNotificationRead.mockResolvedValue({ ok: true });
  actions.markAllNotificationsRead.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  toasts.length = 0;
  latest = null;
});

describe('useNotificationFeed polling', () => {
  it('a hidden tab sends no poll in five minutes', async () => {
    visibility = 'hidden';
    renderWithIntl(<Probe feed={FEED} />, { locale: 'en' });
    await advance(5 * NOTIFICATION_POLL_MS);
    expect(actions.pollNotificationFeed).not.toHaveBeenCalled();
  });

  it('a visible tab polls once a minute and shows what arrives', async () => {
    renderWithIntl(<Probe feed={FEED} />, { locale: 'en' });
    await advance(NOTIFICATION_POLL_MS - 1);
    expect(actions.pollNotificationFeed).not.toHaveBeenCalled();
    actions.pollNotificationFeed.mockResolvedValue({
      ok: true,
      data: { unreadCount: 2, items: [item('b'), item('a')] },
    });
    await advance(1);
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('2');
    await advance(2 * NOTIFICATION_POLL_MS);
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(3);
  });

  it('never overlaps: a slow poll swallows the ticks that come while it runs', async () => {
    let answer: (value: unknown) => void = () => {};
    actions.pollNotificationFeed.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderWithIntl(<Probe feed={FEED} />, { locale: 'en' });
    await advance(3 * NOTIFICATION_POLL_MS);
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(1);
    await act(async () => answer({ ok: true, data: FEED }));
    await advance(NOTIFICATION_POLL_MS);
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(2);
  });

  it('coming back into view polls at once; going away stops the clock', async () => {
    renderWithIntl(<Probe feed={FEED} />, { locale: 'en' });
    visibility = 'hidden';
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await advance(3 * NOTIFICATION_POLL_MS);
    expect(actions.pollNotificationFeed).not.toHaveBeenCalled();
    visibility = 'visible';
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(1);
  });

  it('R7: returning to the tab polls at most once per 15 s, however often focus fires', async () => {
    renderWithIntl(<Probe feed={FEED} />, { locale: 'en' });
    const focus = () => act(async () => void window.dispatchEvent(new Event('focus')));
    await focus();
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(1);
    for (let second = 0; second < 14; second += 2) {
      await advance(2_000);
      await focus();
    }
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(1);
    await advance(RETURN_POLL_MIN_GAP_MS);
    await focus();
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(2);
  });

  it('a failed poll keeps what is shown, silently', async () => {
    actions.pollNotificationFeed.mockResolvedValue({ ok: false, error: 'generic' });
    renderWithIntl(<Probe feed={FEED} />, { locale: 'en' });
    await advance(NOTIFICATION_POLL_MS);
    actions.pollNotificationFeed.mockRejectedValue(new Error('offline'));
    await advance(NOTIFICATION_POLL_MS);
    expect(screen.getByRole('status').textContent).toBe('1');
    expect(toasts).toEqual([]);
  });
});

describe('useNotificationFeed marking', () => {
  it('marks on screen first, then tells the server', async () => {
    renderWithIntl(<Probe feed={FEED} />, { locale: 'en' });
    await act(async () => latest?.markRead('a'));
    expect(screen.getByRole('status').textContent).toBe('0');
    expect(latest?.items[0].read).toBe(true);
    expect(actions.markNotificationRead).toHaveBeenCalledWith('a');
  });

  it('a refused mark says so and re-reads the truth', async () => {
    actions.markAllNotificationsRead.mockResolvedValue({ ok: false, error: 'generic' });
    renderWithIntl(<Probe feed={FEED} />, { locale: 'en' });
    await act(async () => latest?.markAllRead());
    expect(toasts).toHaveLength(1);
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('1');
  });
});

const bell = (feed: NotificationFeed) => (
  <NotificationFeedProvider initialFeed={feed}>
    <NotificationBell />
  </NotificationFeedProvider>
);

describe('NotificationBell count', () => {
  it.each([
    [3, '3'],
    [12, '9+'],
  ])('%i unread shows "%s" (a count, not a dot)', (unreadCount, shown) => {
    const { container } = renderWithIntl(bell({ unreadCount, items: [] }), { locale: 'ar-EG' });
    expect(container.querySelector('[data-unread-badge]')?.textContent).toBe(shown);
  });

  it('nothing unread shows no badge', () => {
    const { container } = renderWithIntl(bell({ unreadCount: 0, items: [] }), { locale: 'en' });
    expect(container.querySelector('[data-unread-badge]')).toBeNull();
  });
});

describe('one feed for the bell and the notifications page (R7)', () => {
  it('the page adds no poller: one poll a minute with both on screen', async () => {
    renderWithIntl(
      <NotificationFeedProvider initialFeed={FEED}>
        <NotificationBell />
        <NotificationsClient initialFeed={{ unreadCount: 1, items: [item('a'), item('z', true)] }} />
      </NotificationFeedProvider>,
      { locale: 'en' },
    );
    await advance(5 * NOTIFICATION_POLL_MS);
    expect(actions.pollNotificationFeed).toHaveBeenCalledTimes(5);
  });

  it('marking read on the page is read in the bell too', async () => {
    const { container } = renderWithIntl(
      <NotificationFeedProvider initialFeed={FEED}>
        <NotificationBell />
        <NotificationsClient initialFeed={FEED} />
      </NotificationFeedProvider>,
      { locale: 'en' },
    );
    expect(container.querySelector('[data-unread-badge]')?.textContent).toBe('1');
    await act(async () => void screen.getByRole('button', { name: 'Mark read' }).click());
    expect(container.querySelector('[data-unread-badge]')).toBeNull();
  });
});
