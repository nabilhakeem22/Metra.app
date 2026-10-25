import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { pickOption } from '@/test/pick-option';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { SiteTeamPanel } from './site-team-panel';
import { TeamTab } from './team-tab';
import type { SiteTeamMember } from './team-tab-types';
import { TEAM_ASSIGN_FIELDS } from './use-team-assign-form';

// The project's Team tab, its site team (PR S3, plan S3.2): a manager adds a
// member (refusals under the member box) and takes one off (after a confirm);
// a reader sees the team and no act; a role without access is told so.

const actions = vi.hoisted(() => ({ assignSiteMember: vi.fn(), unassignSiteMember: vi.fn() }));
vi.mock('@/lib/site/assignments/actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

const ON_TEAM: SiteTeamMember = {
  userId: 'u-eng',
  role: 'site_engineer',
  name: 'Karim Samy',
  email: 'karim@studio.example',
  assignedAt: '2026-10-20T09:00:00.000Z',
};
const CANDIDATE: SiteTeamMember = { userId: 'u-pm', role: 'project_manager', name: 'Mona Adel', email: 'mona@studio.example', assignedAt: null };
const UNNAMED: SiteTeamMember = { userId: 'u-viewer', role: 'viewer', name: null, email: null, assignedAt: null };

function renderPanel(locale: TestLocale, { canManage = true, members = [ON_TEAM, CANDIDATE, UNNAMED] } = {}) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  renderWithIntl(<SiteTeamPanel projectId="p-1" members={members} canManage={canManage} currentUserId="u-pm" />, { locale });
}

beforeEach(() => {
  Object.values(actions).forEach((action) => action.mockReset());
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('Team tab site team (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const addButton = () => screen.getByRole('button', { name: at('projects.profile.team.assign') });
  const under = () => document.getElementById('siteTeamMember-error')?.textContent;
  const option = (member: SiteTeamMember) =>
    `${member.name ?? at('team.unknownUser')} · ${at(`roles.${member.role}.label`)}`;
  const press = async (button: HTMLElement) => {
    await act(async () => {
      fireEvent.click(button);
    });
  };

  test('lists who is on the site team, with the email for a manager, and offers only the others', async () => {
    renderPanel(locale);
    const list = screen.getByRole('list', { name: at('projects.profile.team.title') });
    expect(list.textContent).toContain('Karim Samy');
    expect(list.textContent).toContain('karim@studio.example');
    expect(list.textContent).toContain(at('roles.site_engineer.label'));
    expect(list.textContent).toContain('20/10/2026');
    expect(list.textContent).not.toContain('Mona Adel');
    fireEvent.pointerDown(document.getElementById('siteTeamMember')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await act(async () => {});
    expect(screen.getAllByRole('option').map((element) => element.textContent)).toEqual([option(CANDIDATE), option(UNNAMED)]);
  });

  test('Add is enabled with no member chosen; pressing it asks for one under the box and sends nothing', async () => {
    renderPanel(locale);
    expect((addButton() as HTMLButtonElement).disabled).toBe(false);
    await press(addButton());
    expect(actions.assignSiteMember).not.toHaveBeenCalled();
    expect(under()).toBe(at('errors.field.required'));
  });

  test('adds the chosen member and says so; an already-added one says that instead', async () => {
    actions.assignSiteMember.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true, already: true });
    renderPanel(locale);
    await pickOption('siteTeamMember', option(CANDIDATE));
    await press(addButton());
    expect(actions.assignSiteMember).toHaveBeenCalledWith({ projectId: 'p-1', userId: 'u-pm' });
    expect(toast).toHaveBeenLastCalledWith({ title: at('projects.profile.team.assigned') });
    await pickOption('siteTeamMember', option(CANDIDATE));
    await press(addButton());
    expect(toast).toHaveBeenLastCalledWith({ title: at('projects.profile.team.alreadyAssigned') });
  });

  test('a member who left the studio meanwhile (not_member) is said under the member box, not toasted', async () => {
    actions.assignSiteMember.mockResolvedValue({ ok: false, error: 'not_member' });
    renderPanel(locale);
    await pickOption('siteTeamMember', option(CANDIDATE));
    await press(addButton());
    expect(under()).toBe(at('errors.not_member'));
    expect(toast).not.toHaveBeenCalled();
  });

  test('a refusal no field owns (the project is gone) is said above the button', async () => {
    actions.assignSiteMember.mockResolvedValue({ ok: false, error: 'project_not_found' });
    renderPanel(locale);
    await pickOption('siteTeamMember', option(CANDIDATE));
    await press(addButton());
    expect(screen.getByRole('alert').textContent).toBe(at('errors.project_not_found'));
  });

  test('the server refusal lands under the member box (AC 19)', async () => {
    renderPanel(locale);
    await pickOption('siteTeamMember', option(CANDIDATE));
    await expectFieldErrorsRenderUnderFields({
      fields: TEAM_ASSIGN_FIELDS,
      controlIdOf: () => 'siteTeamMember',
      answerWith: (result: ActionResult) => actions.assignSiteMember.mockResolvedValue(result),
      submit: () => press(addButton()),
      locale,
    });
  });

  test('takes a member off after the confirm, and toasts why when refused', async () => {
    actions.unassignSiteMember.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'entry_not_found' });
    renderPanel(locale);
    const remove = () => screen.getByRole('button', { name: `${at('projects.profile.team.remove')}: Karim Samy` });
    await press(remove());
    expect(actions.unassignSiteMember).not.toHaveBeenCalled();
    await press(screen.getByRole('button', { name: at('projects.profile.team.remove') }));
    expect(actions.unassignSiteMember).toHaveBeenCalledWith({ projectId: 'p-1', userId: 'u-eng' });
    expect(toast).toHaveBeenLastCalledWith({ title: at('projects.profile.team.removed') });

    await press(remove());
    await press(screen.getByRole('button', { name: at('projects.profile.team.remove') }));
    expect(toast).toHaveBeenLastCalledWith({ title: at('errors.entry_not_found'), variant: 'destructive' });
  });

  test('a reader sees the team, no add form, no remove, and who may change it', () => {
    renderPanel(locale, { canManage: false, members: [{ ...ON_TEAM, email: null }, CANDIDATE] });
    expect(screen.getByRole('list').textContent).toContain('Karim Samy');
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.getElementById('siteTeamMember')).toBeNull();
    expect(screen.getByText(at('projects.profile.team.readonly'))).toBeTruthy();
  });

  test('an empty team says so, and a studio with nobody left to add says that instead of the form', () => {
    renderPanel(locale, { members: [{ ...CANDIDATE, assignedAt: '2026-10-20T09:00:00.000Z' }] });
    expect(screen.getByText(at('projects.profile.team.noCandidates'))).toBeTruthy();
    renderPanel(locale, { members: [] });
    expect(screen.getByText(at('projects.profile.team.empty'))).toBeTruthy();
  });
});

describe('TeamTab', () => {
  test('a role that may not read the site team is told so, with no member data', async () => {
    const { container } = renderWithIntl(await TeamTab({ projectId: 'p-1', data: { access: 'none' } }), { locale: 'en' });
    expect(container.textContent).toBe('projects.profile.team.noAccess');
  });
});
