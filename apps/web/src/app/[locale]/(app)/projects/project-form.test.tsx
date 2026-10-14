import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { PROJECT_CREATE_FIELDS } from '@/lib/projects/fields';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ProjectForm } from './project-form';
import { projectControlId } from './project-form-controls';
import { todayIsoLocal } from './project-form-state';

const actions = vi.hoisted(() => ({ createProject: vi.fn(), updateProject: vi.fn() }));
vi.mock('@/lib/projects/actions', () => actions);
const toasts = vi.hoisted(() => [] as { variant?: string }[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: { variant?: string }) => {
    toasts.push(raised);
  },
}));

const en = (path: string) => messageAt('en', path);
const CLIENTS = [{ id: 'c-1', nameEn: 'Acme', nameAr: null, city: 'Giza', country: null }];
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';

describe('ProjectForm (new)', () => {
  test('no client chosen, today as start, no Status field, no required mark on the end date', () => {
    renderWithIntl(<ProjectForm open onOpenChange={() => {}} clientOptions={CLIENTS} />, {
      locale: 'en',
    });
    expect(screen.getByText(en('projects.form.clientPlaceholder'))).toBeTruthy();
    expect((document.getElementById('pr-start') as HTMLInputElement).value).toBe(
      todayIsoLocal(new Date()),
    );
    expect(document.getElementById('pr-status')).toBeNull();
    const end = document.getElementById('pr-end') as HTMLInputElement;
    expect(end.required).toBe(false);
    expect(end.getAttribute('aria-required')).toBeNull();
    expect((document.getElementById('pr-country') as HTMLInputElement).value).toBe(
      en('projects.form.countryDefault'),
    );
    // Save never waits: pressing it is how a missing name or client is explained.
    expect(
      (screen.getByRole('button', { name: en('projects.form.save') }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test('with zero clients it links to /clients?new=1 for a role that may add one', () => {
    renderWithIntl(
      <ProjectForm open onOpenChange={() => {}} clientOptions={[]} canAddClient />,
      { locale: 'en' },
    );
    expect(
      screen.getByRole('link', { name: en('projects.empty.addClient') }).getAttribute('href'),
    ).toBe('/en/clients?new=1');
  });
});

describe.each<TestLocale>(['en', 'ar-EG'])('ProjectForm refusals (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const ITEM = {
    id: 'p-1',
    code: 'P-2026-0001',
    nameEn: 'Tower',
    nameAr: null,
    clientId: CLIENT_ID,
    status: 'active',
    startDate: '2026-01-01',
    endDate: null,
    city: null,
    country: null,
    address: null,
    notes: null,
  };
  const clients = [{ ...CLIENTS[0], id: CLIENT_ID }];
  const save = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('projects.form.save') }));
    });
  };
  const renderForm = (item?: typeof ITEM) => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(
      <ProjectForm open onOpenChange={() => {}} clientOptions={clients} defaultClientId={CLIENT_ID} item={item as never} />,
      { locale },
    );
  };

  test('every field the server refuses is said under its own control (AC 19)', async () => {
    renderForm();
    fireEvent.change(document.getElementById('pr-nameEn')!, { target: { value: 'Tower' } });
    await expectFieldErrorsRenderUnderFields({
      fields: PROJECT_CREATE_FIELDS,
      controlIdOf: projectControlId,
      answerWith: (result: ActionResult) => actions.createProject.mockResolvedValue(result),
      submit: save,
      locale,
      typed: { 'pr-nameEn': 'Tower' },
    });
  });

  test('a blank name and no client are refused before anything is sent', async () => {
    renderWithIntl(<ProjectForm open onOpenChange={() => {}} clientOptions={clients} />, { locale });
    actions.createProject.mockReset();
    await save();
    expect(actions.createProject).not.toHaveBeenCalled();
    expect(document.getElementById('pr-nameEn-error')?.textContent).toBe(at('errors.name_required'));
    expect(document.getElementById('pr-nameAr')?.getAttribute('aria-describedby')).toContain('pr-nameEn-error');
    expect(document.getElementById('pr-client-error')?.textContent).toBe(at('errors.client_required'));
    expect(toasts.filter((raised) => raised.variant === 'destructive')).toHaveLength(0);
  });

  test('an end date before the start is said under the end date', async () => {
    actions.updateProject.mockResolvedValue(fieldsFailed({ endDate: { code: 'invalid_dates' } }));
    renderForm(ITEM);
    await save();
    expect(document.getElementById('pr-end-error')?.textContent).toBe(at('errors.invalid_dates'));
    expect(document.getElementById('pr-end')?.getAttribute('aria-invalid')).toBe('true');
  });

  test('a field this sheet does not show (notes) is said above the footer, never dropped', async () => {
    actions.updateProject.mockResolvedValue(fieldsFailed({ notes: { code: 'too_long', params: { max: 2000 } } }));
    renderForm(ITEM);
    await save();
    expect(screen.getByRole('alert').textContent).toBe(at('errors.field.too_long').replace('{max}', '2000'));
  });
});
