import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ACCOUNT_FIELDS } from '@/lib/account/field-rules';
import type { ActionResult } from '@/lib/actions/result';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { AccountClient } from './account-client';

const actions = vi.hoisted(() => ({ updateAccount: vi.fn() }));
vi.mock('@/lib/account/actions', () => actions);
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/settings/account',
}));

function renderAccount(locale: TestLocale) {
  renderWithIntl(<AccountClient initialFullName="Mona" email="mona@example.com" currentLocale="en" />, { locale });
}

async function save(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'account.save') }));
  });
}

beforeEach(() => {
  actions.updateAccount.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('Account (%s)', (locale) => {
  test('a refused display name is said under it (AC 19)', async () => {
    renderAccount(locale);
    await expectFieldErrorsRenderUnderFields({
      fields: ACCOUNT_FIELDS,
      controlIdOf: () => 'fullName',
      answerWith: (result: ActionResult) => actions.updateAccount.mockResolvedValue(result),
      submit: () => save(locale),
      locale,
      typed: { fullName: 'Mona' },
    });
    expect(toast).not.toHaveBeenCalled();
  });

  test('a name past the cap is refused before anything is sent', async () => {
    renderAccount(locale);
    fireEvent.change(document.getElementById('fullName')!, { target: { value: 'م'.repeat(201) } });
    await save(locale);
    expect(actions.updateAccount).not.toHaveBeenCalled();
    expect(document.getElementById('fullName-error')?.textContent).toBe(
      messageAt(locale, 'errors.field.too_long').replace('{max}', '200'),
    );
  });
});
