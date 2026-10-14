import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BoqStart } from './boq-start';

const actions = vi.hoisted(() => ({
  commitBoqImport: vi.fn(),
  createBoq: vi.fn(),
  previewBoqImport: vi.fn(),
}));
vi.mock('@/lib/boqs/actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  toast.mockReset();
});

/** Choose a file in the hidden input, the way the Upload button's picker does. */
async function upload(text: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([text], 'boq.csv', { type: 'text/csv' });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

describe.each<TestLocale>(['en', 'ar-EG'])('BoqStart import refusals (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const renderStart = () => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(<BoqStart projectId="p-1" />, { locale });
  };

  test('a refused sheet is said under the upload control', async () => {
    renderStart();
    await expectFieldErrorsRenderUnderFields({
      fields: ['file'],
      controlIdOf: () => 'boq-import-file',
      answerWith: (result: ActionResult) => actions.previewBoqImport.mockResolvedValue(result),
      submit: () => upload('Description,Unit,Qty,Rate\n'),
      locale,
    });
    expect(toast).not.toHaveBeenCalled();
  });

  test('an unreadable sheet says so by its cause, under the upload control', async () => {
    actions.previewBoqImport.mockResolvedValue(fieldsFailed({ file: { code: 'import_unreadable' } }));
    renderStart();
    await upload('\u0000');
    expect(document.getElementById('boq-import-file-error')?.textContent).toBe(at('errors.import_unreadable'));
  });

  test('Import is never disabled: a sheet with no usable line says so under the upload control', async () => {
    actions.previewBoqImport.mockResolvedValue({ ok: true, lines: [], problems: [], notes: [] });
    renderStart();
    await upload('Description,Unit,Qty,Rate\n');
    const commit = screen.getByRole('button', { name: at('projects.profile.boq.commitImport') });
    expect(commit.hasAttribute('disabled')).toBe(false);
    await act(async () => {
      fireEvent.click(commit);
    });
    expect(actions.commitBoqImport).not.toHaveBeenCalled();
    expect(document.getElementById('boq-import-file-error')?.textContent).toBe(at('errors.import_empty'));
  });

  test('a commit that fails is said above the buttons by its cause', async () => {
    actions.previewBoqImport.mockResolvedValue({ ok: true, lines: [{ description: 'Walls' }], problems: [], notes: [] });
    actions.createBoq.mockResolvedValue({ ok: true, data: 'b-1' });
    actions.commitBoqImport.mockResolvedValue({ ok: false, error: 'boq_not_draft' });
    renderStart();
    await upload('Description,Unit,Qty,Rate\nWalls,sqm,1,1\n');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('projects.profile.boq.commitImport') }));
    });
    expect(screen.getByRole('alert').textContent).toBe(at('errors.boq_not_draft'));
  });
});
