import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, renderHook, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { ENGAGEMENT_CREATE_FIELDS } from '@/lib/engagements/create-fields';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { pickOption } from '@/test/pick-option';
import { messageAt, messagesFor, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { EngagementCreateFields } from './engagement-create-fields';
import { EngagementCreateForm } from './engagement-create-form';
import { useDeliveryForm } from './use-delivery-form';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
  usePathname: () => '/en/engagements',
}));
const actions = vi.hoisted(() => ({ createEngagement: vi.fn() }));
vi.mock('@/lib/engagements/actions', () => actions);

const en = (path: string) => messageAt('en', path);
const CLIENTS = [{ id: 'c-1', nameEn: 'Acme', nameAr: null, city: null, country: null }];
const PROJECTS = [{ id: 'p-1', nameEn: 'Tower', nameAr: 'البرج', clientId: 'c-1' }];

describe('EngagementCreateForm', () => {
  test('nothing is preselected: Submit stays enabled and both selects are required', () => {
    renderWithIntl(
      <EngagementCreateForm
        open
        onOpenChange={() => {}}
        clientOptions={CLIENTS}
        projectOptions={PROJECTS}
      />,
      { locale: 'en' },
    );
    const submit = screen.getByRole('button', { name: en('engagements.startDelivery') });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(en('engagements.form.chooseClient'))).toBeTruthy();
    for (const id of ['eng-client', 'eng-project']) {
      expect(document.getElementById(id)?.getAttribute('aria-required')).toBe('true');
    }
  });

  test('with zero clients it says so and links to /clients?new=1 for a role that may add one', () => {
    renderWithIntl(
      <EngagementCreateForm
        open
        onOpenChange={() => {}}
        clientOptions={[]}
        projectOptions={[]}
        setupLinks={{ canAddClient: true, canAddProject: true }}
      />,
      { locale: 'en' },
    );
    expect(screen.getByText(en('engagements.form.needClient'))).toBeTruthy();
    expect(
      screen.getByRole('link', { name: en('engagements.form.addClient') }).getAttribute('href'),
    ).toBe('/en/clients?new=1');
  });
});

describe('useDeliveryForm', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="en" messages={messagesFor('en')} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
  const setup = () =>
    renderHook(
      () => useDeliveryForm({ open: true, projectOptions: PROJECTS, lock: {}, onCreated: () => {} }),
      { wrapper },
    );

  test('the title follows the chosen project until one is typed', () => {
    const { result } = setup();
    act(() => result.current.onChange.clientId('c-1'));
    act(() => result.current.onChange.projectId('p-1'));
    expect(result.current.values).toMatchObject({ titleEn: 'Tower', titleAr: 'البرج' });

    act(() => result.current.onChange.titleEn('Villa'));
    act(() => result.current.onChange.projectId('p-1'));
    expect(result.current.values.titleEn).toBe('Villa');
  });

  test('project_delivery_exists is filed under the project field', async () => {
    actions.createEngagement.mockResolvedValue(
      fieldsFailed({ projectId: { code: 'project_delivery_exists' } }),
    );
    const { result } = setup();
    act(() => result.current.onChange.clientId('c-1'));
    act(() => result.current.onChange.projectId('p-1'));
    await act(async () => result.current.submit());
    expect(result.current.errors.messageFor('projectId')).toBe(en('errors.project_delivery_exists'));
    expect(result.current.errors.formError).toBeNull();
  });

  test('while client and project are locked, a refusal about them is said above the form', async () => {
    actions.createEngagement.mockResolvedValue(
      fieldsFailed({ projectId: { code: 'project_delivery_exists' } }),
    );
    const { result } = renderHook(
      () =>
        useDeliveryForm({
          open: true,
          projectOptions: [],
          lock: { clientId: 'c-1', projectId: 'p-1' },
          onCreated: () => {},
        }),
      { wrapper },
    );
    await act(async () => result.current.submit());
    expect(result.current.errors.formError).toBe(en('errors.project_delivery_exists'));
  });
});

describe.each<TestLocale>(['en', 'ar-EG'])('EngagementCreateForm refusals (%s)', (locale) => {
  const at = (path: string) => messageAt(locale, path);
  const renderForm = () => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(
      <EngagementCreateForm open onOpenChange={() => {}} clientOptions={CLIENTS} projectOptions={PROJECTS} />,
      { locale },
    );
  };
  const save = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('engagements.startDelivery') }));
    });
  };

  test('Save with nothing chosen says what is missing under each select and sends nothing', async () => {
    actions.createEngagement.mockReset();
    renderForm();
    await save();
    expect(actions.createEngagement).not.toHaveBeenCalled();
    expect(document.getElementById('eng-client-error')?.textContent).toBe(
      at('errors.engagement_client_required'),
    );
    expect(document.getElementById('eng-project-error')?.textContent).toBe(
      at('errors.engagement_project_required'),
    );
    expect(document.activeElement?.id).toBe('eng-client');
  });

  test('every field the server refuses is said under its own control', async () => {
    renderForm();
    await pickOption('eng-client', 'Acme');
    await pickOption('eng-project', locale === 'ar-EG' ? 'البرج' : 'Tower');
    await expectFieldErrorsRenderUnderFields({
      fields: ENGAGEMENT_CREATE_FIELDS,
      controlIdOf: (field) =>
        ({ title: 'eng-titleEn', clientId: 'eng-client', projectId: 'eng-project' })[field],
      answerWith: (result: ActionResult) => actions.createEngagement.mockResolvedValue(result),
      submit: save,
      locale,
    });
    expect(document.getElementById('eng-titleAr')?.getAttribute('aria-describedby')).toContain(
      'eng-titleEn-error',
    );
  });
});

describe('EngagementCreateFields', () => {
  test('a project refusal renders inside the project field, after its select', () => {
    renderWithIntl(
      <EngagementCreateFields
        values={{ titleEn: '', titleAr: '', clientId: 'c-1', projectId: 'p-1', offPlan: false }}
        onChange={{
          titleEn: () => {},
          titleAr: () => {},
          clientId: () => {},
          projectId: () => {},
          offPlan: () => {},
        }}
        locked={false}
        clientOptions={CLIENTS}
        projectsForClient={PROJECTS}
        bind={(field) => ({
          error: field === 'projectId' ? en('errors.project_delivery_exists') : undefined,
          onEdit: () => {},
        })}
      />,
      { locale: 'en' },
    );
    const refusal = document.getElementById('eng-project-error');
    expect(refusal?.textContent).toBe(en('errors.project_delivery_exists'));
    expect(refusal?.hasAttribute('role')).toBe(false);
    const projectField = document.getElementById('eng-project')?.parentElement;
    expect(projectField?.contains(refusal ?? null)).toBe(true);
  });
});
