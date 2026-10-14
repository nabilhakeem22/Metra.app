import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Client } from '@metra/db';
import type { ActionResult } from '@/lib/actions/result';
import { CLIENT_FORM_FIELDS } from '@/lib/clients/fields';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { DetailsTab, detailsControlId } from './details-tab';

const actions = vi.hoisted(() => ({ updateClient: vi.fn() }));
vi.mock('@/lib/clients/actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const CLIENT = {
  id: 'c-1',
  nameEn: 'Acme',
  nameAr: null,
  type: 'company',
  contactName: null,
  email: null,
  phone: '01000000000',
  city: null,
  country: null,
  address: null,
  taxRegistrationNumber: null,
  notes: null,
} as unknown as Client;

async function save(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'clients.profile.details.save') }));
  });
}

beforeEach(() => {
  actions.updateClient.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('Client DetailsTab (%s)', (locale) => {
  test('every field the server refuses is said under its own control (AC 19)', async () => {
    renderWithIntl(<DetailsTab client={CLIENT} canManage />, { locale });
    await expectFieldErrorsRenderUnderFields({
      fields: CLIENT_FORM_FIELDS,
      controlIdOf: detailsControlId,
      answerWith: (result: ActionResult) => actions.updateClient.mockResolvedValue(result),
      submit: () => save(locale),
      locale,
      typed: { 'd-nameEn': 'Acme', 'd-phone': '01000000000' },
    });
    expect(toast).not.toHaveBeenCalled();
  });

  test('blanking a stored phone is refused under the phone before anything is sent', async () => {
    renderWithIntl(<DetailsTab client={CLIENT} canManage />, { locale });
    fireEvent.change(document.getElementById('d-phone')!, { target: { value: '' } });
    await save(locale);
    expect(actions.updateClient).not.toHaveBeenCalled();
    expect(document.getElementById('d-phone-error')?.textContent).toBe(messageAt(locale, 'errors.phone_required'));
  });
});
