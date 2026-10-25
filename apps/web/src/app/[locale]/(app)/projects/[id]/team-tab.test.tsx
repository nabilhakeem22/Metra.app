import { act, fireEvent, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import type { SiteTeamPerson } from '@/lib/site/assignments/types';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { pickOption } from '@/test/pick-option';
import { messageAt, messagesFor, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { SiteTeamPanel } from './site-team-panel';
import { TeamTab } from './team-tab';
import type { SiteTeamMember } from './team-tab-types';
import { TEAM_ASSIGN_FIELDS } from './use-team-assign-form';

// The project's Team tab, its site team (PR S3, plan S3.2, and the S3 fix
// round): the tab renders only who is ON the team; a manager's add form asks
// for candidates on demand (a page at a time, narrowed by what he types),
// says refusals under the member box and drops a member who may no longer
// join; a removal asks first, and one already done elsewhere says the list is
// refreshed; the keyboard focus never falls to the page. A reader sees the
// team and no act; a role without access is told so.

const actions = vi.hoisted(() => ({
  assignSiteMember: vi.fn(),
  unassignSiteMember: vi.fn(),
  searchSiteTeamCandidates: vi.fn(),
}));
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
const CANDIDATE: SiteTeamPerson = { userId: 'u-pm', role: 'project_manager', name: 'Mona Adel', email: 'mona@studio.example' };
const UNNAMED: SiteTeamPerson = { userId: 'u-viewer', role: 'viewer', name: null, email: null };

function page(candidates: SiteTeamPerson[], nextOffset: number | null = null) {
  return { ok: true, data: { candidates, nextOffset } };
}

interface PanelOptions {
  canManage?: boolean;
  members?: SiteTeamMember[];
  notShown?: number;
}

function panel({ canManage = true, members = [ON_TEAM], notShown = 0 }: PanelOptions = {}) {
  return <SiteTeamPanel projectId="p-1" members={members} notShown={notShown} canManage={canManage} currentUserId="u-pm" />;
}

function renderPanel(locale: TestLocale, options: PanelOptions = {}) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  const view = renderWithIntl(panel(options), { locale });
  /** The same panel rendered again by the server (the team changed), inside the same catalogue. */
  const again = (next: PanelOptions) =>
    view.rerender(
      <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
        {panel(next)}
      </NextIntlClientProvider>,
    );
  return { again };
}

/** Let the picker's timers and the answers they wait on land. */
async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

beforeEach(() => {
  Object.values(actions).forEach((action) => action.mockReset());
  actions.searchSiteTeamCandidates.mockResolvedValue(page([CANDIDATE, UNNAMED]));
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('Team tab site team (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const addButton = () => screen.getByRole('button', { name: at('projects.profile.team.assign') });
  const moreButton = () => screen.queryByRole('button', { name: at('projects.profile.team.moreCandidates') });
  const under = () => document.getElementById('siteTeamMember-error')?.textContent;
  const option = (member: SiteTeamPerson) => `${member.name ?? at('team.unknownUser')} · ${at(`roles.${member.role}.label`)}`;
  const status = () => screen.getByRole('status').textContent;
  const press = async (button: HTMLElement) => {
    await act(async () => {
      fireEvent.click(button);
    });
  };
  /** Reach the add form the way a keyboard does, which is when it asks for members. */
  const reachForm = async () => {
    fireEvent.focus(document.getElementById('siteTeamFind')!);
    await settle();
  };
  const openOptions = async () => {
    fireEvent.pointerDown(document.getElementById('siteTeamMember')!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await settle();
    const shown = screen.queryAllByRole('option').map((element) => element.textContent);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await settle();
    return shown;
  };
  const type = async (text: string) => {
    fireEvent.change(document.getElementById('siteTeamFind')!, { target: { value: text } });
    await settle(250);
  };

  test('lists who is on the site team, with the email for a manager, and asks for nobody else until the form is reached', async () => {
    renderPanel(locale);
    const list = screen.getByRole('list', { name: at('projects.profile.team.title') });
    expect(list.textContent).toContain('Karim Samy');
    expect(list.textContent).toContain('karim@studio.example');
    expect(list.textContent).toContain(at('roles.site_engineer.label'));
    expect(list.textContent).toContain('20/10/2026');
    await settle(250);
    expect(actions.searchSiteTeamCandidates).not.toHaveBeenCalled();
    expect(status(), 'nothing is said of the candidates before they are asked for').toBe('');

    await reachForm();
    expect(actions.searchSiteTeamCandidates.mock.calls).toEqual([[{ projectId: 'p-1', query: '', offset: 0 }]]);
    expect(await openOptions()).toEqual([option(CANDIDATE), option(UNNAMED)]);
  });

  test('a press on the member box asks for the members too (a pointer may reach it without a focus)', async () => {
    renderPanel(locale);
    fireEvent.pointerDown(document.getElementById('siteTeamMember')!.parentElement!, { button: 0 });
    await settle();
    expect(actions.searchSiteTeamCandidates).toHaveBeenCalledTimes(1);
    expect(await openOptions()).toEqual([option(CANDIDATE), option(UNNAMED)]);
  });

  test('a typed search asks once per pause, and walks on by itself while a page matched too few', async () => {
    renderPanel(locale);
    await reachForm();
    actions.searchSiteTeamCandidates.mockReset();
    actions.searchSiteTeamCandidates.mockResolvedValueOnce(page([], 20)).mockResolvedValueOnce(page([CANDIDATE], null));
    fireEvent.change(document.getElementById('siteTeamFind')!, { target: { value: 'm' } });
    fireEvent.change(document.getElementById('siteTeamFind')!, { target: { value: 'mo' } });
    await settle(250);
    expect(actions.searchSiteTeamCandidates.mock.calls).toEqual([
      [{ projectId: 'p-1', query: 'mo', offset: 0 }],
      [{ projectId: 'p-1', query: 'mo', offset: 20 }],
    ]);
    expect(await openOptions()).toEqual([option(CANDIDATE)]);
  });

  test('"more members" asks for the next page and adds it; a typed search that finds nobody says so', async () => {
    const twenty = Array.from({ length: 20 }, (_, index) => ({ ...CANDIDATE, userId: `u-${index}`, name: `Member ${index}` }));
    actions.searchSiteTeamCandidates.mockResolvedValueOnce(page(twenty, 20)).mockResolvedValueOnce(page([UNNAMED], null));
    renderPanel(locale);
    await reachForm();
    await press(moreButton()!);
    await settle();
    expect(actions.searchSiteTeamCandidates).toHaveBeenLastCalledWith({ projectId: 'p-1', query: '', offset: 20 });
    expect((await openOptions()).length).toBe(21);
    expect(moreButton()).toBeNull();

    actions.searchSiteTeamCandidates.mockResolvedValue(page([], null));
    await type('zz');
    expect(status()).toBe(at('projects.profile.team.noMatches'));
  });

  test('nobody left to add says so', async () => {
    actions.searchSiteTeamCandidates.mockResolvedValue(page([], null));
    renderPanel(locale);
    await reachForm();
    expect(status()).toBe(at('projects.profile.team.noCandidates'));
  });

  test('a failed ask says so, and "more members" asks again', async () => {
    actions.searchSiteTeamCandidates.mockResolvedValueOnce({ ok: false, error: 'rate_limited' });
    renderPanel(locale);
    await reachForm();
    expect(status()).toBe(at('errors.rate_limited'));
    await press(moreButton()!);
    await settle();
    expect(actions.searchSiteTeamCandidates).toHaveBeenLastCalledWith({ projectId: 'p-1', query: '', offset: 0 });
    expect(await openOptions()).toEqual([option(CANDIDATE), option(UNNAMED)]);
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
    await reachForm();
    await pickOption('siteTeamMember', option(CANDIDATE));
    await press(addButton());
    expect(actions.assignSiteMember).toHaveBeenCalledWith({ projectId: 'p-1', userId: 'u-pm' });
    expect(toast).toHaveBeenLastCalledWith({ title: at('projects.profile.team.assigned') });
    await pickOption('siteTeamMember', option(CANDIDATE));
    await press(addButton());
    expect(toast).toHaveBeenLastCalledWith({ title: at('projects.profile.team.alreadyAssigned') });
  });

  test('the keyboard focus stays on Add while it works and after (F4); a second press sends nothing', async () => {
    let answer: (result: ActionResult) => void = () => {};
    actions.assignSiteMember.mockReturnValue(new Promise<ActionResult>((resolve) => (answer = resolve)));
    renderPanel(locale);
    await reachForm();
    await pickOption('siteTeamMember', option(CANDIDATE));
    addButton().focus();
    await press(addButton());
    expect(addButton().getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(addButton());
    await press(addButton());
    expect(actions.assignSiteMember).toHaveBeenCalledTimes(1);
    await act(async () => answer({ ok: true }));
    await settle();
    expect(document.activeElement).toBe(addButton());
  });

  test("a member who may no longer join (not_member) is said under the box in the manager's words and leaves the list (F2)", async () => {
    actions.assignSiteMember.mockResolvedValue({ ok: false, error: 'not_member' });
    renderPanel(locale);
    await reachForm();
    await pickOption('siteTeamMember', option(CANDIDATE));
    await press(addButton());
    expect(under()).toBe(at('errors.field.not_internal_member'));
    expect(toast).not.toHaveBeenCalled();
    expect(await openOptions()).toEqual([option(UNNAMED)]);
  });

  test('a refusal no field owns (the project is gone) is said above the button', async () => {
    actions.assignSiteMember.mockResolvedValue({ ok: false, error: 'project_not_found' });
    renderPanel(locale);
    await reachForm();
    await pickOption('siteTeamMember', option(CANDIDATE));
    await press(addButton());
    expect(screen.getByRole('alert').textContent).toBe(at('errors.project_not_found'));
  });

  test('the server refusal lands under the member box (AC 19)', async () => {
    renderPanel(locale);
    await reachForm();
    await pickOption('siteTeamMember', option(CANDIDATE));
    await expectFieldErrorsRenderUnderFields({
      fields: TEAM_ASSIGN_FIELDS,
      controlIdOf: () => 'siteTeamMember',
      answerWith: (result: ActionResult) => actions.assignSiteMember.mockResolvedValue(result),
      submit: () => press(addButton()),
      locale,
    });
  });

  test('takes a member off after the confirm; one already off elsewhere says the list is refreshed (F3)', async () => {
    actions.unassignSiteMember
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'entry_not_found' })
      .mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    renderPanel(locale);
    const remove = () => screen.getByRole('button', { name: `${at('projects.profile.team.remove')}: Karim Samy` });
    const confirmRemove = () => press(screen.getByRole('button', { name: at('projects.profile.team.remove') }));
    await press(remove());
    expect(actions.unassignSiteMember).not.toHaveBeenCalled();
    await confirmRemove();
    expect(actions.unassignSiteMember).toHaveBeenCalledWith({ projectId: 'p-1', userId: 'u-eng' });
    expect(toast).toHaveBeenLastCalledWith({ title: at('projects.profile.team.removed') });

    await press(remove());
    await confirmRemove();
    expect(toast).toHaveBeenLastCalledWith({ title: at('projects.profile.team.alreadyRemoved') });

    await press(remove());
    await confirmRemove();
    expect(toast).toHaveBeenLastCalledWith({ title: at('errors.forbidden'), variant: 'destructive' });
  });

  test('the focus goes back to the remove button when the confirm is cancelled (F4)', async () => {
    renderPanel(locale);
    const remove = screen.getByRole('button', { name: `${at('projects.profile.team.remove')}: Karim Samy` });
    remove.focus();
    await press(remove);
    await press(screen.getByRole('button', { name: at('common.cancel') }));
    await settle();
    expect(document.activeElement).toBe(remove);
  });

  test('when the focused row leaves the list, the focus lands on the card title, not on the page (F4)', async () => {
    const view = renderPanel(locale);
    screen.getByRole('button', { name: `${at('projects.profile.team.remove')}: Karim Samy` }).focus();
    view.again({ members: [] });
    await settle();
    expect(document.activeElement?.textContent).toBe(at('projects.profile.team.title'));
  });

  test('the team changing asks the reached picker again (a member taken off is a candidate again)', async () => {
    const view = renderPanel(locale);
    await reachForm();
    view.again({ members: [] });
    await settle();
    expect(actions.searchSiteTeamCandidates).toHaveBeenCalledTimes(2);
  });

  test('a team longer than the tab renders says how many more are on it', () => {
    renderPanel(locale, { notShown: 3 });
    const line = [...document.querySelectorAll('p')].find((paragraph) => paragraph.textContent?.includes('3'));
    expect(line?.textContent, 'the count, said in a sentence').toMatch(/^[^{}]+$/);
  });

  test('a reader sees the team, no add form, no remove, and who may change it; nothing is asked', async () => {
    renderPanel(locale, { canManage: false, members: [{ ...ON_TEAM, email: null }] });
    expect(screen.getByRole('list').textContent).toContain('Karim Samy');
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.getElementById('siteTeamMember')).toBeNull();
    expect(screen.getByText(at('projects.profile.team.readonly'))).toBeTruthy();
    await settle(250);
    expect(actions.searchSiteTeamCandidates).not.toHaveBeenCalled();
  });

  test('an empty team says so', () => {
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
