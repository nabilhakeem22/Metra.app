import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fieldsFailed } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { CLIENT_FORM_FIELDS } from '@/lib/clients/fields';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ClientForm } from './client-form';
import { clientControlId } from './client-form-fields';
import type { ClientRow } from './types';

const actions = vi.hoisted(() => ({ createClient: vi.fn(), updateClient: vi.fn() }));
vi.mock('@/lib/clients/actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

const input = (key: string) => document.getElementById(`cl-${key}`) as HTMLInputElement | null;
const under = (key: string) => document.getElementById(`cl-${key}-error`)?.textContent;

const ITEM = {
  id: 'c-1',
  nameEn: 'Acme',
  nameAr: null,
  contactName: null,
  email: null,
  phone: '01000000000',
  city: null,
  country: null,
  address: null,
  taxRegistrationNumber: null,
  notes: null,
  active: true,
  type: 'company',
  projectCount: 0,
} as ClientRow;

function renderForm(locale: TestLocale, item?: ClientRow) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  renderWithIntl(<ClientForm open onOpenChange={() => {}} item={item} />, { locale });
}

function type(key: string, value: string) {
  fireEvent.change(input(key)!, { target: { value } });
}

async function save(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'clients.form.save') }));
  });
}

beforeEach(() => {
  actions.createClient.mockReset();
  actions.updateClient.mockReset();
  toast.mockReset();
});

describe('ClientForm', () => {
  test('new client: free-text fields are dir="auto", names are marked required, extras are folded', () => {
    renderForm('en');
    for (const key of ['contactName', 'city']) expect(input(key)?.getAttribute('dir')).toBe('auto');
    for (const key of ['nameEn', 'nameAr']) expect(input(key)?.getAttribute('aria-required')).toBe('true');
    expect(screen.getByText(messageAt('en', 'clients.form.contactNote'))).toBeTruthy();
    for (const key of ['taxRegistrationNumber', 'address', 'notes']) expect(input(key)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `+ ${messageAt('en', 'clients.form.moreDetails')}` }));
    expect(input('taxRegistrationNumber')).not.toBeNull();
    for (const key of ['address', 'notes']) expect(input(key)?.getAttribute('dir')).toBe('auto');
  });

  test('editing a client that has an address opens More details from the start', () => {
    renderForm('en', { ...ITEM, address: '5 Nile St' });
    expect(input('address')?.value).toBe('5 Nile St');
    expect(screen.queryByText(messageAt('en', 'clients.form.contactNote'))).toBeNull();
  });
});

describe.each<TestLocale>(['en', 'ar-EG'])('ClientForm refusals (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('every field the server refuses is said under its own control (AC 18, 19)', async () => {
    renderForm(locale);
    type('nameEn', 'Acme');
    type('phone', '01000000000');
    await expectFieldErrorsRenderUnderFields({
      fields: CLIENT_FORM_FIELDS,
      controlIdOf: clientControlId,
      answerWith: (result: ActionResult) => actions.createClient.mockResolvedValue(result),
      submit: () => save(locale),
      locale,
      typed: { 'cl-nameEn': 'Acme', 'cl-phone': '01000000000' },
    });
  });

  test('all empty: nothing is sent; the names and the phone each say what is missing (AC 24)', async () => {
    renderForm(locale);
    await save(locale);
    expect(actions.createClient).not.toHaveBeenCalled();
    expect(under('nameEn')).toBe(at('errors.name_required'));
    expect(input('nameAr')?.getAttribute('aria-invalid')).toBe('true');
    expect(input('nameAr')?.getAttribute('aria-describedby')).toContain('cl-nameEn-error');
    expect(under('phone')).toBe(at('errors.phone_required'));
    expect(document.activeElement).toBe(input('nameEn'));
    expect(toast).not.toHaveBeenCalled();
  });

  test('a refusal under a folded field unfolds it and takes the focus (AC 25)', async () => {
    actions.updateClient.mockResolvedValue(fieldsFailed({ notes: { code: 'too_long', params: { max: 2000 } } }));
    renderForm(locale, ITEM);
    expect(input('notes')).toBeNull();
    await save(locale);
    expect(under('notes')).toBe(at('errors.field.too_long').replace('{max}', '2000'));
    expect(document.activeElement).toBe(input('notes'));
  });

  test('typing in a name clears the name refusal, the phone refusal stays', async () => {
    renderForm(locale);
    await save(locale);
    type('nameAr', 'أكمي');
    expect(under('nameEn')).toBeUndefined();
    expect(input('nameAr')?.getAttribute('aria-invalid')).toBeNull();
    expect(under('phone')).toBe(at('errors.phone_required'));
  });

  test('a refusal no field owns is said above the footer; a lost answer says so', async () => {
    actions.updateClient.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    renderForm(locale, ITEM);
    await save(locale);
    expect(screen.getByRole('alert').textContent).toBe(at('errors.forbidden'));
    actions.updateClient.mockRejectedValueOnce(new TypeError('fetch failed'));
    await save(locale);
    expect(screen.getByRole('alert').textContent).toBe(at('errors.unreachable'));
  });
});
