import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { CONTACT_FIELDS } from '@/lib/client-contacts/fields';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { EMPTY_CONTACT_DRAFT, type ContactDraft } from './contact-draft';
import { ContactForm, contactControlId } from './contact-form';

const actions = vi.hoisted(() => ({ createContact: vi.fn(), updateContact: vi.fn() }));
vi.mock('@/lib/client-contacts/actions', () => actions);
vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderForm(locale: TestLocale, draft: ContactDraft) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  renderWithIntl(
    <ContactForm clientId="c-1" open onOpenChange={() => {}} draft={draft} onDraftChange={() => {}} />,
    { locale },
  );
}

async function save(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'clients.profile.contacts.add') }));
  });
}

beforeEach(() => actions.createContact.mockReset());

describe.each<TestLocale>(['en', 'ar-EG'])('ContactForm (%s)', (locale) => {
  test('every field the server refuses is said under its own control (AC 19)', async () => {
    renderForm(locale, { ...EMPTY_CONTACT_DRAFT, name: 'Omar' });
    await expectFieldErrorsRenderUnderFields({
      fields: CONTACT_FIELDS,
      controlIdOf: contactControlId,
      answerWith: (result: ActionResult) => actions.createContact.mockResolvedValue(result),
      submit: () => save(locale),
      locale,
      typed: { 'ct-name': 'Omar' },
    });
  });

  test('a blank name is refused under the name before anything is sent', async () => {
    renderForm(locale, EMPTY_CONTACT_DRAFT);
    await save(locale);
    expect(actions.createContact).not.toHaveBeenCalled();
    expect(document.getElementById('ct-name-error')?.textContent).toBe(messageAt(locale, 'errors.field.required'));
    expect(document.activeElement?.id).toBe('ct-name');
  });
});
