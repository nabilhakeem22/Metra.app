import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { DocumentThread } from './document-thread';

// After a send, the client's thread says the team has been notified only when
// the portal action says a notification row was written.

const actions = vi.hoisted(() => ({
  addDeliveryComment: vi.fn(),
  loadDeliveryDocumentComments: vi.fn(),
}));
vi.mock('../actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const DOCUMENT = '11111111-1111-4111-8111-111111111111';

const BOX = `comment-${DOCUMENT}`;

async function open(locale: TestLocale) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  renderWithIntl(<DocumentThread token="tok" documentId={DOCUMENT} initialCount={0} />, { locale });
  fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'delivery.comments.toggleEmpty') }));
  await screen.findByText(messageAt(locale, 'delivery.comments.empty'));
}

async function press(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'delivery.comments.send') }));
  });
}

async function openAndSend(locale: TestLocale) {
  await open(locale);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Is this oak?' } });
  await press(locale);
}

beforeEach(() => {
  actions.addDeliveryComment.mockReset();
  actions.loadDeliveryDocumentComments.mockReset().mockResolvedValue([]);
  router.refresh.mockReset();
});

describe('DocumentThread', () => {
  it('says the team was notified when the studio was', async () => {
    actions.addDeliveryComment.mockResolvedValue({ ok: true, studioNotified: true });
    await openAndSend('ar-EG');
    expect((await screen.findByRole('status')).textContent).toBe(
      messageAt('ar-EG', 'delivery.comments.notified'),
    );
    expect(actions.addDeliveryComment).toHaveBeenCalledWith('tok', DOCUMENT, 'Is this oak?');
    // A sent message re-reads the page from the server, once.
    expect(router.refresh).toHaveBeenCalledTimes(1);
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
    expect((await screen.findByRole('alert')).textContent).toBe(messageAt('en', 'portal.errors.too_many'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('a code the portal has no copy for reads as the generic error', async () => {
    actions.addDeliveryComment.mockResolvedValue({ ok: false, error: 'already_responded' });
    await openAndSend('ar-EG');
    expect((await screen.findByRole('alert')).textContent).toBe(messageAt('ar-EG', 'portal.errors.generic'));
  });
});

// W3.7: the comment box says a blank, too-long or too-many send under itself,
// in فصحى, and an unknown failure hands the client its reference.
describe.each<TestLocale>(['en', 'ar-EG'])('the comment box (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  it('a refused body is said under the box (AC 19)', async () => {
    await open(locale);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Is this oak?' } });
    await expectFieldErrorsRenderUnderFields({
      fields: ['body'],
      controlIdOf: () => BOX,
      answerWith: (result) => actions.addDeliveryComment.mockResolvedValue(result),
      submit: () => press(locale),
      locale,
      namespace: 'portal.errors',
      typed: { [BOX]: 'Is this oak?' },
    });
  });

  it('a blank message is said under the box before anything is sent', async () => {
    await open(locale);
    await press(locale);
    expect(actions.addDeliveryComment).not.toHaveBeenCalled();
    expect(document.getElementById(`${BOX}-error`)?.textContent).toBe(at('portal.errors.field.required'));
    expect(document.activeElement?.id).toBe(BOX);
  });

  it('an unknown failure says so with its reference; a dropped connection says to check it', async () => {
    actions.addDeliveryComment.mockResolvedValue({ ok: false, error: 'generic', reference: 'K7Q29MXD' });
    await openAndSend(locale);
    expect((await screen.findByRole('alert')).textContent).toBe(
      `${at('portal.errors.generic')} ${at('portal.errors.reference').replace('{reference}', 'K7Q29MXD')}`,
    );
    actions.addDeliveryComment.mockRejectedValue(new TypeError('Failed to fetch'));
    await press(locale);
    expect(screen.getByRole('alert').textContent).toBe(at('portal.errors.unreachable'));
  });
});
