import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { API_KEY_FIELDS } from '@/lib/api-keys/field-rules';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ApiKeysClient } from './api-keys-client';

const actions = vi.hoisted(() => ({ mintApiKey: vi.fn(), revokeApiKey: vi.fn() }));
vi.mock('@/lib/api-keys/actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

async function create(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'apiKeys.create') }));
  });
}

beforeEach(() => {
  actions.mintApiKey.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('ApiKeysClient (%s)', (locale) => {
  test('Create with no label asks for one under the box and mints nothing', async () => {
    renderWithIntl(<ApiKeysClient initialKeys={[]} />, { locale });
    expect((screen.getByRole('button', { name: messageAt(locale, 'apiKeys.create') }) as HTMLButtonElement).disabled).toBe(false);
    await create(locale);
    expect(actions.mintApiKey).not.toHaveBeenCalled();
    expect(document.getElementById('api-key-label-error')?.textContent).toBe(messageAt(locale, 'errors.field.required'));
  });

  test('a label the server refuses is said under the box (AC 19)', async () => {
    renderWithIntl(<ApiKeysClient initialKeys={[]} />, { locale });
    fireEvent.change(document.getElementById('api-key-label')!, { target: { value: 'Zapier' } });
    await expectFieldErrorsRenderUnderFields({
      fields: API_KEY_FIELDS,
      controlIdOf: () => 'api-key-label',
      answerWith: (result: ActionResult) => actions.mintApiKey.mockResolvedValue(result),
      submit: () => create(locale),
      locale,
      typed: { 'api-key-label': 'Zapier' },
    });
    expect(toast).not.toHaveBeenCalled();
  });
});
