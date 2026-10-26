import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ClientPageControl } from './client-page-control';

// H4.3: the contract page's "Client page" control. One tap asks for the
// client's home and shows its Execution tab link to copy, or says why there is
// none, or the refusal, in the studio's words; a rejected action never strands
// the button.

const actions = vi.hoisted(() => ({ openClientHome: vi.fn() }));
vi.mock('@/lib/client-home/actions', () => actions);

const CONTRACT_ID = '00000000-0000-4000-8000-0000000000c1';

async function press(locale: TestLocale) {
  renderWithIntl(<ClientPageControl contractId={CONTRACT_ID} />, { locale });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'contracts.clientPage.open') }));
  });
}

beforeEach(() => actions.openClientHome.mockReset());

describe.each<TestLocale>(['ar-EG', 'en'])('the client page control (%s)', (locale) => {
  it('shows the home link to copy', async () => {
    actions.openClientHome.mockResolvedValue({ ok: true, link: 'https://example.invalid/ar-EG/d/raw?tab=execution' });
    await press(locale);
    expect(actions.openClientHome).toHaveBeenCalledWith(CONTRACT_ID);
    expect(screen.getByText('https://example.invalid/ar-EG/d/raw?tab=execution').getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('button', { name: messageAt(locale, 'contracts.clientPage.copy') })).toBeTruthy();
  });

  it.each(['delivery_links_not_configured', 'delivery_link_unrecoverable'] as const)('says why there is no link: %s', async (reason) => {
    actions.openClientHome.mockResolvedValue({ ok: true, link: null, linkReason: reason });
    await press(locale);
    expect(screen.getByRole('status').textContent).toBe(messageAt(locale, `contracts.clientPage.reason.${reason}`));
  });

  it('says a refusal, and a rejected action, in its own words', async () => {
    actions.openClientHome.mockResolvedValue({ ok: false, error: 'client_home_unavailable' });
    await press(locale);
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'errors.client_home_unavailable'));
    actions.openClientHome.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'contracts.clientPage.open') }));
    });
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'errors.unreachable'));
    expect((screen.getByRole('button', { name: messageAt(locale, 'contracts.clientPage.open') }) as HTMLButtonElement).disabled).toBe(false);
  });
});
