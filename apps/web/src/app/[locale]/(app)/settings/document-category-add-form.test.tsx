import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { BILINGUAL_NAME_FIELDS } from '@/lib/validation/text-field-rules';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { DocumentCategoryAddForm, categoryControlId } from './document-category-add-form';

const actions = vi.hoisted(() => ({ createDocumentCategory: vi.fn() }));
vi.mock('@/lib/document-categories/actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));

async function add(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'settings.documentCategories.add') }));
  });
}

beforeEach(() => actions.createDocumentCategory.mockReset());

describe.each<TestLocale>(['en', 'ar-EG'])('DocumentCategoryAddForm (%s)', (locale) => {
  test('Add with no name asks for one under the Arabic name and sends nothing', async () => {
    renderWithIntl(<DocumentCategoryAddForm />, { locale });
    await add(locale);
    expect(actions.createDocumentCategory).not.toHaveBeenCalled();
    expect(document.getElementById('dc-ar-error')?.textContent).toBe(messageAt(locale, 'errors.name_required'));
    expect(document.getElementById('dc-en')?.getAttribute('aria-describedby')).toContain('dc-ar-error');
    expect(document.activeElement?.id).toBe('dc-ar');
  });

  test('every name refusal from the server is said under its own control (AC 19)', async () => {
    renderWithIntl(<DocumentCategoryAddForm />, { locale });
    fireEvent.change(document.getElementById('dc-en')!, { target: { value: 'Permits' } });
    await expectFieldErrorsRenderUnderFields({
      fields: BILINGUAL_NAME_FIELDS,
      controlIdOf: categoryControlId,
      answerWith: (result: ActionResult) => actions.createDocumentCategory.mockResolvedValue(result),
      submit: () => add(locale),
      locale,
      typed: { 'dc-en': 'Permits' },
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
