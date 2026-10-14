import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { INVITE_FIELDS } from '@/lib/team/invite-field-rules';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { openMenu } from '@/test/open-menu';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { TeamClient } from './team-client';

const actions = vi.hoisted(() => ({
  inviteMember: vi.fn(),
  resendInvite: vi.fn(),
  revokeInvite: vi.fn(),
  changeMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));
vi.mock('@/lib/team/actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

const PENDING = [
  { id: 'inv-1', email: 'sara@example.com', role: 'viewer', expiresAt: '2026-10-20T00:00:00.000Z', createdAt: '2026-10-13T00:00:00.000Z', expired: false },
];

function renderTeam(locale: TestLocale) {
  renderWithIntl(
    <TeamClient members={[]} pending={PENDING as never} canManage isOwner currentUserId="u-1" />,
    { locale },
  );
}

const sendButton = (locale: TestLocale) => screen.getByRole('button', { name: messageAt(locale, 'team.sendInvite') });
const under = () => document.getElementById('inviteEmail-error')?.textContent;

async function send(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(sendButton(locale));
  });
}

beforeEach(() => {
  Object.values(actions).forEach((action) => action.mockReset());
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('Team invite (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('Send is enabled with an empty address; pressing it asks for one and sends nothing (AC 27)', async () => {
    renderTeam(locale);
    expect((sendButton(locale) as HTMLButtonElement).disabled).toBe(false);
    await send(locale);
    expect(actions.inviteMember).not.toHaveBeenCalled();
    expect(under()).toBe(at('errors.field.required'));
    expect(document.activeElement?.id).toBe('inviteEmail');
  });

  test('a malformed address is said under Email and nothing is sent (AC 27)', async () => {
    renderTeam(locale);
    fireEvent.change(document.getElementById('inviteEmail')!, { target: { value: 'sara@' } });
    await send(locale);
    expect(actions.inviteMember).not.toHaveBeenCalled();
    expect(under()).toBe(at('errors.field.email_format'));
  });

  test('a pending invite for that address is said under Email (AC 27)', async () => {
    actions.inviteMember.mockResolvedValue(fieldsFailed({ email: { code: 'pending_exists' } }));
    renderTeam(locale);
    fireEvent.change(document.getElementById('inviteEmail')!, { target: { value: 'sara@example.com' } });
    await send(locale);
    expect(under()).toBe(at('errors.pending_exists'));
    expect(toast).not.toHaveBeenCalled();
  });

  test('the server refusal lands under Email (AC 19)', async () => {
    renderTeam(locale);
    fireEvent.change(document.getElementById('inviteEmail')!, { target: { value: 'sara@example.com' } });
    await expectFieldErrorsRenderUnderFields({
      fields: INVITE_FIELDS,
      controlIdOf: () => 'inviteEmail',
      answerWith: (result: ActionResult) => actions.inviteMember.mockResolvedValue(result),
      submit: () => send(locale),
      locale,
      typed: { inviteEmail: 'sara@example.com' },
    });
  });
});

describe('Team row acts', () => {
  test('a resend of an invite accepted meanwhile toasts that cause', async () => {
    actions.resendInvite.mockResolvedValue({ ok: false, error: 'record_not_found' });
    renderTeam('en');
    openMenu(messageAt('en', 'common.moreActions'));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: messageAt('en', 'team.resend') }));
    });
    expect(toast).toHaveBeenCalledWith({ title: messageAt('en', 'errors.record_not_found'), variant: 'destructive' });
  });
});
