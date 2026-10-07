import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { openMenu } from '@/test/open-menu';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ShareLinkPanel } from './share-link-panel';
import type { DeliveryShareApi } from './use-delivery-share';

const en = (path: string) => messageAt('en', path);

function sharedLink(): DeliveryShareApi {
  return {
    pending: false,
    shared: true,
    link: null,
    copied: false,
    open: true,
    setOpen: vi.fn(),
    error: null,
    share: vi.fn(),
    reveal: vi.fn(),
    rotate: vi.fn(),
    revoke: vi.fn(),
    copy: vi.fn(),
  };
}

function choose(share: DeliveryShareApi, item: 'rotate' | 'revoke') {
  renderWithIntl(<ShareLinkPanel share={share} />, { locale: 'en' });
  expect(screen.queryByRole('button', { name: en(`delivery.share.${item}`) })).toBeNull();
  openMenu(en('delivery.share.moreActions'));
  fireEvent.click(screen.getByRole('menuitem', { name: en(`delivery.share.${item}`) }));
}

describe('the client link menu', () => {
  test('revoke fires only after the confirm', async () => {
    const share = sharedLink();
    choose(share, 'revoke');
    expect(share.revoke).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole('button', { name: en('delivery.share.confirmRevoke.confirm') }),
    );
    await waitFor(() => expect(share.revoke).toHaveBeenCalledTimes(1));
    expect(share.rotate).not.toHaveBeenCalled();
  });

  test('cancelling the revoke confirm fires nothing', async () => {
    const share = sharedLink();
    choose(share, 'revoke');
    fireEvent.click(await screen.findByRole('button', { name: en('common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(share.revoke).not.toHaveBeenCalled();
  });

  test('rotating asks first too, and Escape fires nothing', async () => {
    const share = sharedLink();
    choose(share, 'rotate');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(en('delivery.share.confirmRotate.title'));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(share.rotate).not.toHaveBeenCalled();
  });

  test('Show link reveals the existing link and never rotates it', () => {
    const share = sharedLink();
    renderWithIntl(<ShareLinkPanel share={share} />, { locale: 'en' });
    fireEvent.click(screen.getByRole('button', { name: en('delivery.share.showLink') }));
    expect(share.reveal).toHaveBeenCalledTimes(1);
    expect(share.rotate).not.toHaveBeenCalled();
  });

  test('a link that cannot be re-created says so, and points at Replace', () => {
    const share = { ...sharedLink(), error: 'delivery_link_unrecoverable' };
    renderWithIntl(<ShareLinkPanel share={share} />, { locale: 'en' });
    expect(screen.getByRole('alert').textContent).toBe(en('delivery.share.unrecoverable'));
  });

  test('F9: a server without the link secret says so instead of "try again"', () => {
    const share = { ...sharedLink(), error: 'delivery_links_not_configured' };
    renderWithIntl(<ShareLinkPanel share={share} />, { locale: 'en' });
    expect(screen.getByRole('alert').textContent).toBe(en('delivery.share.notConfigured'));
  });

  test('a delivery not yet shared offers only the Share button', () => {
    const share = { ...sharedLink(), shared: false };
    renderWithIntl(<ShareLinkPanel share={share} />, { locale: 'en' });
    expect(screen.getByRole('button', { name: en('delivery.share.shareCta') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en('delivery.share.moreActions') })).toBeNull();
  });
});
