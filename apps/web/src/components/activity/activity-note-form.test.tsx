import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { ACTIVITY_FIELDS } from '@/lib/activities/field-rules';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ACTIVITY_NOTE_ID, ActivityNoteForm } from './activity-note-form';

const actions = vi.hoisted(() => ({ addActivity: vi.fn() }));
vi.mock('@/lib/activities/actions', () => actions);
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

function renderForm(locale: TestLocale) {
  renderWithIntl(<ActivityNoteForm entityType="client" entityId="c-1" placeholder="…" addLabel="Add note" />, {
    locale,
  });
}

async function add() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  });
}

beforeEach(() => actions.addActivity.mockReset());

describe.each<TestLocale>(['en', 'ar-EG'])('ActivityNoteForm (%s)', (locale) => {
  test('Add on an empty box asks for text under it and sends nothing', async () => {
    renderForm(locale);
    await add();
    expect(actions.addActivity).not.toHaveBeenCalled();
    expect(document.getElementById(`${ACTIVITY_NOTE_ID}-error`)?.textContent).toBe(
      messageAt(locale, 'errors.field.required'),
    );
    expect(document.activeElement?.id).toBe(ACTIVITY_NOTE_ID);
  });

  test('a note the server refuses is said under the box (AC 19)', async () => {
    renderForm(locale);
    fireEvent.change(document.getElementById(ACTIVITY_NOTE_ID)!, { target: { value: 'Called the client' } });
    await expectFieldErrorsRenderUnderFields({
      fields: ACTIVITY_FIELDS,
      controlIdOf: () => ACTIVITY_NOTE_ID,
      answerWith: (result: ActionResult) => actions.addActivity.mockResolvedValue(result),
      submit: add,
      locale,
      typed: { [ACTIVITY_NOTE_ID]: 'Called the client' },
    });
  });
});
