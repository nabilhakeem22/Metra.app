import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { DeliveryReminderDialog } from './delivery-reminder-dialog';
import { openDeliveryReminder } from './share-anchor';

// "Send reminder" (B11): the WhatsApp link carries the EXISTING client link,
// opening the dialog never rotates it, and a link that cannot be re-created is
// replaced only behind a confirmation.

vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
const actions = vi.hoisted(() => ({
  prepareDeliveryReminder: vi.fn(),
  emailDeliveryReminder: vi.fn(),
  rotateDeliveryLink: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => actions);

afterEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
});

const en = (path: string) => messageAt('en', path);
const LINK_AR = 'https://metra.app/ar-EG/d/tok-1';
const LINK_EN = 'https://metra.app/en/d/tok-1';

const READY = {
  ok: true,
  data: {
    defaultLocale: 'ar-EG',
    messages: { 'ar-EG': `مرحبًا أحمد\n${LINK_AR}`, en: `Hello Ahmed\n${LINK_EN}` },
    whatsappDigits: '201012345678',
    clientEmail: 'ahmed@example.com',
  },
};

async function openDialog() {
  renderWithIntl(<DeliveryReminderDialog engagementId="e-1" />, { locale: 'en' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => openDeliveryReminder());
  return screen.findByRole('dialog');
}

const whatsappLink = () =>
  screen.getByRole('link', { name: en('engagements.reminder.openWhatsapp') }) as HTMLAnchorElement;

describe('the reminder dialog', () => {
  test('opens on the studio language with a wa.me link carrying the existing link; nothing rotates', async () => {
    actions.prepareDeliveryReminder.mockResolvedValue(READY);
    await openDialog();
    const link = await waitFor(whatsappLink);
    expect(link.href.startsWith('https://wa.me/20')).toBe(true);
    expect(decodeURIComponent(link.href.split('?text=')[1])).toContain(LINK_AR);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.hasAttribute('data-primary-action')).toBe(true);
    expect(actions.prepareDeliveryReminder).toHaveBeenCalledWith('e-1');
    expect(actions.rotateDeliveryLink).not.toHaveBeenCalled();
  });

  test('switching the language switches the message and its link', async () => {
    actions.prepareDeliveryReminder.mockResolvedValue(READY);
    await openDialog();
    await waitFor(whatsappLink);
    fireEvent.click(screen.getByRole('button', { name: en('engagements.reminder.locale.en') }));
    expect(decodeURIComponent(whatsappLink().href.split('?text=')[1])).toContain(LINK_EN);
    expect(screen.getByText(/Hello Ahmed/).getAttribute('dir')).toBe('ltr');
  });

  test('email sends in the chosen language, and says so', async () => {
    actions.prepareDeliveryReminder.mockResolvedValue(READY);
    actions.emailDeliveryReminder.mockResolvedValue({ ok: true });
    await openDialog();
    await waitFor(whatsappLink);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en('engagements.reminder.email') }));
    });
    expect(actions.emailDeliveryReminder).toHaveBeenCalledWith('e-1', 'ar-EG');
    expect((await screen.findByRole('status')).textContent).toBe(en('engagements.reminder.emailSent'));
  });

  test('no email on file: the email button is disabled with its reason', async () => {
    actions.prepareDeliveryReminder.mockResolvedValue({
      ...READY,
      data: { ...READY.data, clientEmail: null, whatsappDigits: null },
    });
    await openDialog();
    await waitFor(whatsappLink);
    const email = screen.getByRole('button', { name: en('engagements.reminder.email') }) as HTMLButtonElement;
    expect(email.disabled).toBe(true);
    expect(screen.getByText(en('engagements.reminder.noEmail'))).toBeTruthy();
    expect(whatsappLink().href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(screen.getByText(en('engagements.reminder.noNumber'))).toBeTruthy();
  });

  test('an unrecoverable link offers ONE replacement, and only after the confirm', async () => {
    actions.prepareDeliveryReminder
      .mockResolvedValueOnce({ ok: false, error: 'delivery_link_unrecoverable' })
      .mockResolvedValueOnce(READY);
    actions.rotateDeliveryLink.mockResolvedValue({ ok: true, link: LINK_AR });
    await openDialog();
    const replace = await screen.findByRole('button', { name: en('engagements.reminder.replace') });
    expect(screen.getByText(en('engagements.reminder.unrecoverableBody'))).toBeTruthy();

    // Cancelling the confirm rotates nothing.
    fireEvent.click(replace);
    fireEvent.click(await screen.findByRole('button', { name: en('common.cancel') }));
    await act(async () => {});
    expect(actions.rotateDeliveryLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: en('engagements.reminder.replace') }));
    const confirm = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(
        [...confirm.querySelectorAll('button')].find(
          (button) => button.textContent === en('engagements.reminder.replace'),
        )!,
      );
    });
    expect(actions.rotateDeliveryLink).toHaveBeenCalledTimes(1);
    expect(actions.rotateDeliveryLink).toHaveBeenCalledWith('e-1');
    await waitFor(whatsappLink);
    expect(actions.prepareDeliveryReminder).toHaveBeenCalledTimes(2);
  });

  test('any other refusal is said in words', async () => {
    actions.prepareDeliveryReminder.mockResolvedValue({ ok: false, error: 'forbidden' });
    await openDialog();
    expect((await screen.findByRole('alert')).textContent).toBe(en('errors.forbidden'));
  });
});
