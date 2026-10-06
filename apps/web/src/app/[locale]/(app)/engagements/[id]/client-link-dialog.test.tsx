import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { openMenu } from '@/test/open-menu';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ClientLinkDialog } from './client-link-dialog';
import { revealDeliveryShareLink } from './share-anchor';

vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
const actions = vi.hoisted(() => ({
  shareDeliveryLink: vi.fn(),
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

  test('the close button closes it', async () => {
    renderWithIntl(<ClientLinkDialog engagementId="e-1" initialShared={false} />, { locale: 'en' });
    act(() => revealDeliveryShareLink());
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: en('common.close') }));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
