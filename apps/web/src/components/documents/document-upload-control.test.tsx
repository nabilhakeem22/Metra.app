import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { DOCUMENT_UPLOAD_FIELDS } from '@/lib/documents/fields';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { DOCUMENT_CATEGORY_ID, DocumentUploadControl } from './document-upload-control';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const createUpload = vi.fn();
const CATEGORIES = [{ id: 'cat-1', nameEn: 'Permits', nameAr: 'تصاريح' }];
const text = (key: string) => key;

function renderControl(locale: TestLocale) {
  renderWithIntl(<DocumentUploadControl categories={CATEGORIES} createUpload={createUpload} t={text} />, { locale });
}

async function pickFile() {
  const input = document.querySelector('input[type="file"]')!;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(['x'], 'plan.pdf', { type: 'application/pdf' })] } });
  });
}

beforeEach(() => {
  createUpload.mockReset();
  toast.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe.each<TestLocale>(['en', 'ar-EG'])('DocumentUploadControl (%s)', (locale) => {
  test('a category retired meanwhile is said under the picker (AC 19)', async () => {
    renderControl(locale);
    fireEvent.change(document.getElementById(DOCUMENT_CATEGORY_ID)!, { target: { value: 'cat-1' } });
    await expectFieldErrorsRenderUnderFields({
      fields: DOCUMENT_UPLOAD_FIELDS,
      controlIdOf: () => DOCUMENT_CATEGORY_ID,
      answerWith: (result: ActionResult) => createUpload.mockResolvedValue(result),
      submit: pickFile,
      locale,
      typed: { [DOCUMENT_CATEGORY_ID]: 'cat-1' },
    });
    expect(toast).not.toHaveBeenCalled();
  });

  test('Storage refusing the bytes says so under the button', async () => {
    createUpload.mockResolvedValue({ signedUrl: 'https://storage.example/put' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    renderControl(locale);
    await pickFile();
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'errors.storage_unavailable'));
    expect(toast).not.toHaveBeenCalled();
  });
});
