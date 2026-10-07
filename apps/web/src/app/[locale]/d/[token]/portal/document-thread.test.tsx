import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { DocumentThread } from './document-thread';

// After a send, the client's thread says the team has been notified only when
// the portal action says a notification row was written.

const actions = vi.hoisted(() => ({
  addDeliveryComment: vi.fn(),
  loadDeliveryDocumentComments: vi.fn(),
}));
vi.mock('../actions', () => actions);

const DOCUMENT = '11111111-1111-4111-8111-111111111111';

async function openAndSend(locale: 'ar-EG' | 'en') {
  renderWithIntl(<DocumentThread token="tok" documentId={DOCUMENT} initialCount={0} />, { locale });
  fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'delivery.comments.toggleEmpty') }));
  await screen.findByText(messageAt(locale, 'delivery.comments.empty'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Is this oak?' } });
  fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'delivery.comments.send') }));
}

beforeEach(() => {
  actions.addDeliveryComment.mockReset();
  actions.loadDeliveryDocumentComments.mockReset().mockResolvedValue([]);
});

describe('DocumentThread', () => {
  it('says the team was notified when the studio was', async () => {
    actions.addDeliveryComment.mockResolvedValue({ ok: true, studioNotified: true });
    await openAndSend('ar-EG');
    expect((await screen.findByRole('status')).textContent).toBe(
      messageAt('ar-EG', 'delivery.comments.notified'),
    );
    expect(actions.addDeliveryComment).toHaveBeenCalledWith('tok', DOCUMENT, 'Is this oak?');
  });

  it('says nothing about notifying when the studio was not', async () => {
    actions.addDeliveryComment.mockResolvedValue({ ok: true, studioNotified: false });
    await openAndSend('en');
    await waitFor(() => expect(actions.loadDeliveryDocumentComments).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(messageAt('en', 'delivery.comments.notified'))).toBeNull();
  });

  it('a failed send shows its error and no notified line', async () => {
    actions.addDeliveryComment.mockResolvedValue({ ok: false, error: 'too_many', studioNotified: false });
    await openAndSend('en');
    expect((await screen.findByRole('alert')).textContent).toBe(
      messageAt('en', 'delivery.comments.error.too_many'),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
