import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import type { ProjectWithType } from '@/lib/projects/queries';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { projectDetailsControlId } from './details-fields';
import { DetailsTab } from './details-tab';
import { NEW_TYPE_ID } from './details-type-field';
import { PROJECT_DETAILS_FIELDS } from './use-project-details-form';

const actions = vi.hoisted(() => ({ updateProject: vi.fn(), addProjectType: vi.fn() }));
vi.mock('@/lib/projects/actions', () => ({ updateProject: actions.updateProject }));
vi.mock('@/lib/project-types/actions', () => ({ addProjectType: actions.addProjectType }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT = {
  id: 'p-1',
  code: 'P-2026-0001',
  nameEn: 'Tower',
  nameAr: null,
  clientId: CLIENT_ID,
  typeId: null,
  status: 'active',
  description: null,
  startDate: '2026-01-01',
  endDate: null,
  city: null,
  country: null,
  address: null,
  notes: null,
} as unknown as ProjectWithType;
const CLIENTS = [{ id: CLIENT_ID, nameEn: 'Acme', nameAr: null }];

function renderTab(locale: TestLocale) {
  renderWithIntl(<DetailsTab project={PROJECT} clientOptions={CLIENTS} projectTypes={[]} canManage />, { locale });
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

beforeEach(() => {
  actions.updateProject.mockReset();
  actions.addProjectType.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('Project DetailsTab (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('every field the server refuses is said under its own control (AC 19)', async () => {
    renderTab(locale);
    await expectFieldErrorsRenderUnderFields({
      fields: PROJECT_DETAILS_FIELDS,
      controlIdOf: projectDetailsControlId,
      answerWith: (result: ActionResult) => actions.updateProject.mockResolvedValue(result),
      submit: () => click(at('projects.profile.details.save')),
      locale,
      typed: { 'p-nameEn': 'Tower', 'p-code': 'P-2026-0001' },
    });
    expect(toast).not.toHaveBeenCalled();
  });

  test('Add type on an empty box asks for a name under it and sends nothing', async () => {
    renderTab(locale);
    await click(at('projects.profile.details.addType'));
    expect(actions.addProjectType).not.toHaveBeenCalled();
    expect(document.getElementById(`${NEW_TYPE_ID}-error`)?.textContent).toBe(at('errors.name_required'));
    expect(document.activeElement?.id).toBe(NEW_TYPE_ID);
  });
});
