import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ClientContact } from '@metra/db';
import { openMenu } from '@/test/open-menu';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ContactsList } from './contacts-list';

const actions = vi.hoisted(() => ({ deleteContact: vi.fn(), setPrimaryContact: vi.fn() }));
vi.mock('@/lib/client-contacts/actions', () => actions);
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
// The Undo window is the hook's own (tested there); here it passes at once.
const undo = vi.hoisted(() => ({ titles: [] as string[] }));
vi.mock('@/hooks/undo-toast', () => ({
  UNDO_WINDOW_MS: 0,
  showUndoToast: (options: { title: string }) => undo.titles.push(options.title),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));

afterEach(() => {
  actions.deleteContact.mockReset();
  actions.setPrimaryContact.mockReset();
  undo.titles.length = 0;
});

const en = (path: string) => messageAt('en', path);

const contact = {
  id: 'k-1',
  name: 'Mona',
  role: 'Owner',
  phone: '0100',
  email: 'mona@example.com',
  isPrimary: false,
} as ClientContact;

function chooseDelete() {
  renderWithIntl(<ContactsList contacts={[contact]} canManage onEdit={() => {}} />, {
    locale: 'en',
  });
  expect(
    screen.queryByRole('button', { name: en('clients.profile.contacts.delete') }),
  ).toBeNull();
  openMenu(en('common.moreActions'));
  fireEvent.click(
    screen.getByRole('menuitem', { name: en('clients.profile.contacts.delete') }),
  );
}

describe('deleting a contact', () => {
  test('lives in the row menu, fires only after the confirm, and offers Undo', async () => {
    actions.deleteContact.mockResolvedValue({ ok: true });
    chooseDelete();
    expect(actions.deleteContact).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole('button', {
        name: en('clients.profile.contacts.confirmDelete.confirm'),
      }),
    );
    await waitFor(() => expect(actions.deleteContact).toHaveBeenCalledTimes(1));
    expect(actions.deleteContact).toHaveBeenCalledWith('k-1');
    expect(undo.titles).toEqual([en('clients.profile.contacts.deleted')]);
    expect(screen.queryByText('Mona')).toBeNull();
  });

  test('Cancel fires nothing and the contact stays', async () => {
    chooseDelete();
    fireEvent.click(await screen.findByRole('button', { name: en('common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(actions.deleteContact).not.toHaveBeenCalled();
    expect(screen.getByText('Mona')).toBeTruthy();
  });

  test('Set primary sits in the same menu and runs at once', async () => {
    actions.setPrimaryContact.mockResolvedValue({ ok: true });
    renderWithIntl(<ContactsList contacts={[contact]} canManage onEdit={() => {}} />, {
      locale: 'en',
    });
    openMenu(en('common.moreActions'));
    fireEvent.click(
      screen.getByRole('menuitem', { name: en('clients.profile.contacts.setAsPrimary') }),
    );
    await waitFor(() => expect(actions.setPrimaryContact).toHaveBeenCalledWith('k-1'));
  });
});
