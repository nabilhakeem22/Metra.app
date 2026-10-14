import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { AcceptInvite } from './accept-client';

const actions = vi.hoisted(() => ({ acceptInvite: vi.fn() }));
vi.mock('@/lib/team/actions', () => actions);
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));

async function accept(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'accept.acceptButton') }));
  });
}

beforeEach(() => {
  actions.acceptInvite.mockReset();
  router.push.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('AcceptInvite (%s)', (locale) => {
  test.each(['invite_expired', 'invite_wrong_account', 'invite_not_found'])(
    '%s renders its own sentence, and never the invited address',
    async (code) => {
      actions.acceptInvite.mockResolvedValue({ ok: false, error: code });
      renderWithIntl(<AcceptInvite token="t-1" />, { locale });
      await accept(locale);
      expect(screen.getByText(messageAt(locale, `errors.${code}`))).toBeTruthy();
      expect(document.body.textContent).not.toContain('@');
      expect(screen.queryByRole('button', { name: messageAt(locale, 'accept.acceptButton') })).toBeNull();
    },
  );

  test('a failure on our side keeps Accept, with the reference to quote', async () => {
    actions.acceptInvite.mockResolvedValue({ ok: false, error: 'generic', reference: 'K7Q29MXD' });
    renderWithIntl(<AcceptInvite token="t-1" />, { locale });
    await accept(locale);
    expect(screen.getByRole('alert').textContent).toContain('K7Q29MXD');
    expect(screen.getByRole('button', { name: messageAt(locale, 'accept.acceptButton') })).toBeTruthy();
  });
});
