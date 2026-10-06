import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ClientContact } from '@metra/db';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ContactsTab } from './contacts-tab';

const actions = vi.hoisted(() => ({
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
  setPrimaryContact: vi.fn(),
}));
vi.mock('@/lib/client-contacts/actions', () => actions);
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const en = (path: string) => messageAt('en', path);
const field = (key: string) => document.getElementById(`ct-${key}`) as HTMLInputElement | null;

const CONTACT = {
  id: 'k-1',
  name: 'Mona',
  role: 'Owner',
  phone: '0100',
  email: null,
  whatsapp: null,
  isPrimary: false,
} as ClientContact;

function renderTab() {
  renderWithIntl(<ContactsTab clientId="c-1" contacts={[CONTACT]} canManage />, { locale: 'en' });
}

describe('ContactsTab', () => {
  test('no inline form: the fields exist only once Add opens the sheet', () => {
    renderTab();
    expect(field('name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en('clients.profile.contacts.add') }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain(en('clients.profile.contacts.newTitle'));
    expect(field('name')?.value).toBe('');
    expect(field('name')?.getAttribute('aria-required')).toBe('true');
  });

  test('a row edit opens the same sheet with that contact', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: en('clients.profile.contacts.editTitle') }));
    expect(screen.getByRole('dialog').textContent).toContain(en('clients.profile.contacts.editTitle'));
    expect(field('name')?.value).toBe('Mona');
    expect(field('role')?.value).toBe('Owner');
  });

  test('a refused name is said under the name, and the sheet stays open', async () => {
    actions.updateContact.mockResolvedValue({ ok: false, error: 'name_required' });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: en('clients.profile.contacts.editTitle') }));
    await act(async () => {
      fireEvent.submit(field('name')!.closest('form')!);
    });
    expect(document.getElementById('ct-name-error')?.textContent).toBe(en('errors.name_required'));
    expect(field('name')?.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  test('a saved contact closes the sheet', async () => {
    actions.createContact.mockResolvedValue({ ok: true });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: en('clients.profile.contacts.add') }));
    fireEvent.change(field('name')!, { target: { value: 'Omar' } });
    await act(async () => {
      fireEvent.submit(field('name')!.closest('form')!);
    });
    expect(actions.createContact).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'c-1', name: 'Omar', isPrimary: false }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
