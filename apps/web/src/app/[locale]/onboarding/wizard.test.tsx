import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { OnboardingWizard } from './wizard';

const actions = vi.hoisted(() => ({
  createOrg: vi.fn(),
  createLogoUpload: vi.fn(),
  setOrgLogo: vi.fn(),
}));
vi.mock('@/lib/org/actions', () => actions);
vi.mock('@/lib/org/logo-actions', () => actions);
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));

function form(locale: TestLocale = 'en'): HTMLFormElement {
  const submit = screen.getByRole('button', { name: messageAt(locale, 'onboarding.create') });
  return submit.closest('form')!;
}

beforeEach(() => {
  actions.createOrg.mockReset();
  router.push.mockReset();
});

describe('the one-screen onboarding', () => {
  test('is one form with one submit: names, city and logo, no firm type or tax field', () => {
    renderWithIntl(<OnboardingWizard />, { locale: 'en' });
    expect(form().querySelectorAll('button[type="submit"]')).toHaveLength(1);
    expect([...form().querySelectorAll('input')].map((input) => input.id)).toEqual([
      'nameAr',
      'nameEn',
      'city',
      'logo',
    ]);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  test('Enter with only the Arabic name creates the studio and lands on the dashboard', async () => {
    actions.createOrg.mockResolvedValue({ ok: true });
    renderWithIntl(<OnboardingWizard />, { locale: 'en' });
    fireEvent.change(document.getElementById('nameAr')!, { target: { value: '  ستوديو النيل  ' } });
    await act(async () => {
      fireEvent.submit(form());
    });
    expect(actions.createOrg).toHaveBeenCalledTimes(1);
    // The firm type is the core's default and the tax number stays in Settings.
    expect(actions.createOrg).toHaveBeenCalledWith({ nameEn: null, nameAr: 'ستوديو النيل', city: null });
    expect(router.push).toHaveBeenCalledWith('/dashboard');
  });

  test('without a name it asks for one under the form and sends nothing', () => {
    renderWithIntl(<OnboardingWizard />, { locale: 'en' });
    fireEvent.submit(form());
    expect(screen.getByRole('alert').textContent).toBe(messageAt('en', 'onboarding.errorRequired'));
    expect(actions.createOrg).not.toHaveBeenCalled();
  });

  test('a refusal renders under the form and the studio stays on the page', async () => {
    actions.createOrg.mockResolvedValue({ ok: false, error: 'name_required' });
    renderWithIntl(<OnboardingWizard />, { locale: 'ar-EG' });
    fireEvent.change(document.getElementById('nameEn')!, { target: { value: 'Nile' } });
    await act(async () => {
      fireEvent.submit(form('ar-EG'));
    });
    expect(screen.getByRole('alert').textContent).toBe(messageAt('ar-EG', 'errors.name_required'));
    expect(router.push).not.toHaveBeenCalled();
  });

  test('F5: each field stops at the server cap and says so under itself', () => {
    renderWithIntl(<OnboardingWizard />, { locale: 'ar-EG' });
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    expect([input('nameAr').maxLength, input('nameEn').maxLength, input('city').maxLength]).toEqual([200, 200, 120]);
    fireEvent.change(input('city'), { target: { value: 'ج'.repeat(120) } });
    const message = messageAt('ar-EG', 'onboarding.tooLong').replace('{max}', '120');
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(input('city').getAttribute('aria-invalid')).toBe('true');
  });

  test('F5: a value past the cap (a paste the input did not stop) is never sent', async () => {
    renderWithIntl(<OnboardingWizard />, { locale: 'en' });
    fireEvent.change(document.getElementById('nameAr')!, { target: { value: 'ا'.repeat(201) } });
    await act(async () => {
      fireEvent.submit(form());
    });
    expect(actions.createOrg).not.toHaveBeenCalled();
    expect(screen.getByText(messageAt('en', 'onboarding.tooLong').replace('{max}', '200'))).toBeTruthy();
  });
});
