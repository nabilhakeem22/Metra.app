import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { DocumentThread } from './document-thread';

// Round D fix F1: a thread read the per-link budget refused is NOT an empty
// thread. It shows a LOAD error (never "that didn't send"), the next open reads
// again, and a refused re-read after a successful send keeps every message on
// screen, the client's new one included, saying some may be missing.

const actions = vi.hoisted(() => ({
  addDeliveryComment: vi.fn(),
  loadDeliveryDocumentComments: vi.fn(),
}));
vi.mock('../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const DOCUMENT = '11111111-1111-4111-8111-111111111111';
const REFUSED = { refused: true };
const REPLIES = [1, 2, 3].map((index) => ({
  id: `reply-${index}`,
  channel: 'staff' as const,
  authorName: null,
  body: `Studio reply ${index}`,
  createdAt: '2026-10-10T10:00:00Z',
}));
const en = (path: string) => messageAt('en', path);

function renderThread(initialCount = 3) {
  renderWithIntl(<DocumentThread token="tok" documentId={DOCUMENT} initialCount={initialCount} />, { locale: 'en' });
}

function toggle() {
  fireEvent.click(screen.getByRole('button', { name: /3|Ask about this/ }));
}

beforeEach(() => {
  actions.addDeliveryComment.mockReset();
  actions.loadDeliveryDocumentComments.mockReset();
});

describe('DocumentThread when the read budget refuses', () => {
  it('a refused read shows the load error, never "No messages yet", and keeps the server count', async () => {
    actions.loadDeliveryDocumentComments.mockResolvedValue(REFUSED);
    renderThread();
    toggle();
    expect((await screen.findByRole('alert')).textContent).toBe(en('delivery.comments.error.load_failed'));
    expect(en('delivery.comments.error.load_failed')).not.toBe(en('portal.errors.generic'));
    expect(screen.queryByText(en('delivery.comments.empty'))).toBeNull();
    expect(screen.getByRole('button', { name: /3/ })).toBeTruthy();
  });

  it('a re-open after the budget returns reads the thread again', async () => {
    actions.loadDeliveryDocumentComments.mockResolvedValueOnce(REFUSED).mockResolvedValue(REPLIES);
    renderThread();
    toggle();
    await screen.findByRole('alert');
    toggle();
    toggle();
    expect(await screen.findByText('Studio reply 2')).toBeTruthy();
    expect(actions.loadDeliveryDocumentComments).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refused re-read after a send keeps the replies and shows the new message, with no error', async () => {
    actions.loadDeliveryDocumentComments.mockResolvedValueOnce(REPLIES).mockResolvedValue(REFUSED);
    actions.addDeliveryComment.mockResolvedValue({ ok: true, studioNotified: true });
    renderThread();
    toggle();
    await screen.findByText('Studio reply 1');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Is this oak?' } });
    fireEvent.click(screen.getByRole('button', { name: en('delivery.comments.send') }));
    await waitFor(() => expect(actions.loadDeliveryDocumentComments).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Is this oak?')).toBeTruthy();
    for (const reply of REPLIES) expect(screen.getByText(reply.body)).toBeTruthy();
    expect(screen.queryByText(en('delivery.comments.empty'))).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(en('delivery.comments.partial'))).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toBe(en('delivery.comments.notified'));
  });

  it('F5: refused first read, then a send whose re-read is refused: the own message AND a missing-messages notice', async () => {
    actions.loadDeliveryDocumentComments.mockResolvedValue(REFUSED);
    actions.addDeliveryComment.mockResolvedValue({ ok: true, studioNotified: true });
    renderThread();
    toggle();
    await screen.findByRole('alert');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello?' } });
    fireEvent.click(screen.getByRole('button', { name: en('delivery.comments.send') }));
    expect(await screen.findByText('Hello?')).toBeTruthy();
    expect(screen.getByText(en('delivery.comments.partial'))).toBeTruthy();
    expect(screen.queryByText(en('delivery.comments.empty'))).toBeNull();
  });
});
