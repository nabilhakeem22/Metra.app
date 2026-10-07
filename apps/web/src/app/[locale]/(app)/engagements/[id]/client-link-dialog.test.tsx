import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { openMenu } from '@/test/open-menu';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ClientLinkDialog } from './client-link-dialog';
import { announceDeliveryLinkChanged, revealDeliveryShareLink } from './share-anchor';

vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
const actions = vi.hoisted(() => ({
  shareDeliveryLink: vi.fn(),
  revealDeliveryLink: vi.fn(),
  rotateDeliveryLink: vi.fn(),
  revokeDeliveryLink: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => actions);

const en = (path: string) => messageAt('en', path);

describe('the client link dialog', () => {
  test('stays closed until asked, then opens from revealDeliveryShareLink()', async () => {
    renderWithIntl(<ClientLinkDialog engagementId="e-1" initialShared />, { locale: 'en' });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => revealDeliveryShareLink());
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText(en('delivery.share.sharedHint'))).toBeTruthy();
  });

  test('opening it writes nothing; Revoke still asks before it fires', async () => {
    actions.revokeDeliveryLink.mockResolvedValue({ ok: true });
    renderWithIntl(<ClientLinkDialog engagementId="e-1" initialShared />, { locale: 'en' });
    act(() => revealDeliveryShareLink());
    await screen.findByRole('dialog');
    expect(actions.rotateDeliveryLink).not.toHaveBeenCalled();
    expect(actions.shareDeliveryLink).not.toHaveBeenCalled();
    openMenu(en('delivery.share.moreActions'));
    fireEvent.click(screen.getByRole('menuitem', { name: en('delivery.share.revoke') }));
    expect(actions.revokeDeliveryLink).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole('button', { name: en('delivery.share.confirmRevoke.confirm') }),
    );
    await act(async () => {});
    expect(actions.revokeDeliveryLink).toHaveBeenCalledWith('e-1');
  });

  test('Show link shows the link the client already has, and rotates nothing', async () => {
    actions.revealDeliveryLink.mockResolvedValue({ ok: true, link: 'https://metra.app/en/d/tok-1' });
    renderWithIntl(<ClientLinkDialog engagementId="e-1" initialShared />, { locale: 'en' });
    act(() => revealDeliveryShareLink());
    await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en('delivery.share.showLink') }));
    });
    expect(actions.revealDeliveryLink).toHaveBeenCalledWith('e-1');
    expect(await screen.findByText('https://metra.app/en/d/tok-1')).toBeTruthy();
    expect(actions.rotateDeliveryLink).not.toHaveBeenCalled();
  });

  test('the close button closes it', async () => {
    renderWithIntl(<ClientLinkDialog engagementId="e-1" initialShared={false} />, { locale: 'en' });
    act(() => revealDeliveryShareLink());
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: en('common.close') }));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('F4: it follows the server after a refresh, so Share is not offered over a live link', async () => {
    // The page re-renders the dialog with the server's answer after router.refresh().
    function Page() {
      const [shared, setShared] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setShared(true)}>
            refreshed
          </button>
          <ClientLinkDialog engagementId="e-1" initialShared={shared} />
        </>
      );
    }
    renderWithIntl(<Page />, { locale: 'en' });
    fireEvent.click(screen.getByRole('button', { name: 'refreshed' }));
    act(() => revealDeliveryShareLink());
    await screen.findByRole('dialog');
    expect(screen.getByRole('button', { name: en('delivery.share.showLink') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en('delivery.share.shareCta') })).toBeNull();
  });

  test('F4: a replacement made from the reminder drops the link this dialog revealed', async () => {
    actions.revealDeliveryLink.mockResolvedValue({ ok: true, link: 'https://metra.app/en/d/old' });
    renderWithIntl(<ClientLinkDialog engagementId="e-1" initialShared />, { locale: 'en' });
    act(() => revealDeliveryShareLink());
    await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en('delivery.share.showLink') }));
    });
    expect(await screen.findByText('https://metra.app/en/d/old')).toBeTruthy();
    act(() => announceDeliveryLinkChanged({ shared: true, source: 'reminder' }));
    expect(screen.queryByText('https://metra.app/en/d/old')).toBeNull();
    expect(screen.getByRole('button', { name: en('delivery.share.showLink') })).toBeTruthy();
  });

  test('a link revoked elsewhere: Show link reads as not shared, not as an error', async () => {
    actions.revealDeliveryLink.mockResolvedValue({ ok: false, error: 'delivery_link_not_shared' });
    renderWithIntl(<ClientLinkDialog engagementId="e-1" initialShared />, { locale: 'en' });
    act(() => revealDeliveryShareLink());
    await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en('delivery.share.showLink') }));
    });
    expect(screen.getByRole('button', { name: en('delivery.share.shareCta') })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
