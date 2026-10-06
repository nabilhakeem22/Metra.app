import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { openMenu } from '@/test/open-menu';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ClientsClient } from './clients-client';
import type { ClientRow } from './types';

const actions = vi.hoisted(() => ({
  setClientActive: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
}));
vi.mock('@/lib/clients/actions', () => actions);
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/hooks/undo-toast', () => ({ showUndoToast: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => actions.setClientActive.mockReset());

const en = (path: string) => messageAt('en', path);

const client: ClientRow = {
  id: 'c-1',
  nameEn: 'Acme',
  nameAr: null,
  contactName: null,
  email: null,
  phone: null,
  city: null,
  country: null,
  address: null,
  taxRegistrationNumber: null,
  notes: null,
  active: true,
  type: 'company',
  projectCount: 0,
};

function renderList() {
  renderWithIntl(<ClientsClient items={[client]} canManage openCreateOnArrival={false} />, {
    locale: 'en',
  });
}

function chooseDeactivate() {
  openMenu(en('common.moreActions'));
  fireEvent.click(screen.getByRole('menuitem', { name: en('clients.actions.deactivate') }));
}

describe('deactivating a client from its row', () => {
  test('is reachable only through the row menu', () => {
    renderList();
    expect(screen.queryByRole('button', { name: en('clients.actions.deactivate') })).toBeNull();
    openMenu(en('common.moreActions'));
    expect(screen.getByRole('menuitem', { name: en('clients.actions.deactivate') })).toBeTruthy();
  });

  test('fires only after the confirm, exactly once', async () => {
    actions.setClientActive.mockResolvedValue({ ok: true });
    renderList();
    chooseDeactivate();
    expect(actions.setClientActive).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole('button', { name: en('clients.confirmDeactivate.confirm') }),
    );
    await waitFor(() => expect(actions.setClientActive).toHaveBeenCalledTimes(1));
    expect(actions.setClientActive).toHaveBeenCalledWith('c-1', false);
  });

  test('Cancel fires nothing', async () => {
    renderList();
    chooseDeactivate();
    fireEvent.click(await screen.findByRole('button', { name: en('common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(actions.setClientActive).not.toHaveBeenCalled();
  });
});
