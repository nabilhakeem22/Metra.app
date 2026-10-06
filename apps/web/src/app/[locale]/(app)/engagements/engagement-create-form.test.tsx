import { describe, expect, test, vi } from 'vitest';
import { act, renderHook, screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { EngagementCreateFields } from './engagement-create-fields';
import { EngagementCreateForm } from './engagement-create-form';
import { canSubmitDelivery } from './engagement-create-validation';
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
  test('nothing is preselected: Submit is disabled and both selects are required', () => {
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
    expect((submit as HTMLButtonElement).disabled).toBe(true);
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
  const setup = () =>
    renderHook(() =>
      useDeliveryForm({ open: true, projectOptions: PROJECTS, lock: {}, onCreated: () => {} }),
    );

  test('the title follows the chosen project until one is typed', () => {
    const { result } = setup();
    act(() => result.current.onChange.clientId('c-1'));
    expect(canSubmitDelivery(result.current.values)).toBe(false);
    act(() => result.current.onChange.projectId('p-1'));
    expect(result.current.values).toMatchObject({ titleEn: 'Tower', titleAr: 'البرج' });
    expect(canSubmitDelivery(result.current.values)).toBe(true);

    act(() => result.current.onChange.titleEn('Villa'));
    act(() => result.current.onChange.projectId('p-1'));
    expect(result.current.values.titleEn).toBe('Villa');
  });

  test('project_delivery_exists is filed under the project field', async () => {
    actions.createEngagement.mockResolvedValue({ ok: false, error: 'project_delivery_exists' });
    const { result } = setup();
    act(() => result.current.onChange.clientId('c-1'));
    act(() => result.current.onChange.projectId('p-1'));
    await act(async () => result.current.submit());
    expect(result.current.error).toEqual({ code: 'project_delivery_exists', field: 'project' });
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
        fieldErrors={{ project: en('errors.project_delivery_exists') }}
      />,
      { locale: 'en' },
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(en('errors.project_delivery_exists'));
    const projectField = document.getElementById('eng-project')?.parentElement;
    expect(projectField?.contains(alert)).toBe(true);
  });
});
