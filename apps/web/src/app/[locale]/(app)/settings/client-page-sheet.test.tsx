import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { CLIENT_PAGE_FIELDS } from '@/lib/org/client-page-details';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { clientPageDraftOf } from './client-page-fields';
import { ClientPageSheet, clientPageControlId } from './client-page-sheet';

const actions = vi.hoisted(() => ({ updateClientPageDetails: vi.fn() }));
vi.mock('@/lib/org/client-page-actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

function renderSheet(locale: TestLocale) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  renderWithIntl(
    <ClientPageSheet open onOpenChange={() => {}} initial={clientPageDraftOf(undefined)} revision="r-1" />,
    { locale },
  );
}

async function save(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'settings.clientPage.save') }));
  });
}

beforeEach(() => {
  actions.updateClientPageDetails.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('ClientPageSheet (%s)', (locale) => {
  test('every field the server refuses is said under its own control (AC 19)', async () => {
    renderSheet(locale);
    await expectFieldErrorsRenderUnderFields({
      fields: CLIENT_PAGE_FIELDS,
      controlIdOf: clientPageControlId,
      answerWith: (result: ActionResult) => actions.updateClientPageDetails.mockResolvedValue(result),
      submit: () => save(locale),
      locale,
    });
    expect(toast).not.toHaveBeenCalled();
  });

  test('a phone and a bank name refused together are both said, each under its field', async () => {
    actions.updateClientPageDetails.mockResolvedValue(
      fieldsFailed({ studioPhone: { code: 'studio_phone_invalid' }, bankName: { code: 'bank_name_required' } }),
    );
    renderSheet(locale);
    await save(locale);
    expect(document.getElementById('client-page-studioPhone-error')?.textContent).toBe(
      messageAt(locale, 'errors.studio_phone_invalid'),
    );
    expect(document.getElementById('client-page-bankName-error')?.textContent).toBe(
      messageAt(locale, 'errors.bank_name_required'),
    );
    expect(document.activeElement?.id).toBe('client-page-studioPhone');
  });

  test('a stale save is said above the footer', async () => {
    actions.updateClientPageDetails.mockResolvedValue({ ok: false, error: 'client_page_details_stale' });
    renderSheet(locale);
    await save(locale);
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'errors.client_page_details_stale'));
  });
});
