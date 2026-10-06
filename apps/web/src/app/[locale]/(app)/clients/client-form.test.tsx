import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { ClientForm } from './client-form';
import type { ClientRow } from './types';

vi.mock('@/lib/clients/actions', () => ({ createClient: vi.fn(), updateClient: vi.fn() }));

const en = (path: string) => messageAt('en', path);
const input = (key: string) => document.getElementById(`cl-${key}`) as HTMLInputElement | null;

describe('ClientForm', () => {
  test('new client: free-text fields are dir="auto", names are marked required, extras are folded', () => {
    renderWithIntl(<ClientForm open onOpenChange={() => {}} />, { locale: 'en' });
    for (const key of ['contactName', 'city']) expect(input(key)?.getAttribute('dir')).toBe('auto');
    for (const key of ['nameEn', 'nameAr']) {
      expect(input(key)?.getAttribute('aria-required')).toBe('true');
    }
    expect(screen.getByText(en('clients.form.contactNote'))).toBeTruthy();
    expect(input('taxRegistrationNumber')).toBeNull();
    expect(input('address')).toBeNull();
    expect(input('notes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: `+ ${en('clients.form.moreDetails')}` }));
    expect(input('taxRegistrationNumber')).not.toBeNull();
    for (const key of ['address', 'notes']) expect(input(key)?.getAttribute('dir')).toBe('auto');
  });

  test('editing a client that has an address opens More details from the start', () => {
    const item = {
      id: 'c-1',
      nameEn: 'Acme',
      nameAr: null,
      contactName: null,
      email: null,
      phone: '01000000000',
      city: null,
      country: null,
      address: '5 Nile St',
      taxRegistrationNumber: null,
      notes: null,
      active: true,
      type: 'company',
      projectCount: 0,
    } as ClientRow;
    renderWithIntl(<ClientForm open onOpenChange={() => {}} item={item} />, { locale: 'en' });
    expect(input('address')?.value).toBe('5 Nile St');
    expect(screen.queryByText(en('clients.form.contactNote'))).toBeNull();
  });
});
