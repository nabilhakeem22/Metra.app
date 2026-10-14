import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ONBOARDING_FIELDS } from './profile-field-limits';
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

  test('without a name it asks for one under the first name, marks both, and sends nothing', () => {
    renderWithIntl(<OnboardingWizard />, { locale: 'en' });
    fireEvent.submit(form());
    expect(document.getElementById('nameAr-error')?.textContent).toBe(messageAt('en', 'errors.name_required'));
    expect(document.getElementById('nameEn')?.getAttribute('aria-describedby')).toContain('nameAr-error');
    expect(document.activeElement?.id).toBe('nameAr');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(actions.createOrg).not.toHaveBeenCalled();
  });

  test('every field the server refuses is said under its own control (AC 19)', async () => {
    renderWithIntl(<OnboardingWizard />, { locale: 'ar-EG' });
    fireEvent.change(document.getElementById('nameAr')!, { target: { value: 'النيل' } });
    await expectFieldErrorsRenderUnderFields({
      fields: ONBOARDING_FIELDS,
      controlIdOf: (field) => (field === 'name' ? 'nameAr' : field),
      answerWith: (result: ActionResult) => actions.createOrg.mockResolvedValue(result),
      submit: async () => {
        await act(async () => {
          fireEvent.submit(form('ar-EG'));
        });
      },
      locale: 'ar-EG',
      typed: { nameAr: 'النيل' },
    });
    expect(router.push).not.toHaveBeenCalled();
  });

  test('a refusal no field owns is said under the form and the studio stays on the page', async () => {
    actions.createOrg.mockResolvedValue({ ok: false, error: 'firm_type_unavailable' });
    renderWithIntl(<OnboardingWizard />, { locale: 'ar-EG' });
    fireEvent.change(document.getElementById('nameEn')!, { target: { value: 'Nile' } });
    await act(async () => {
      fireEvent.submit(form('ar-EG'));
    });
    expect(screen.getByRole('alert').textContent).toBe(messageAt('ar-EG', 'errors.firm_type_unavailable'));
    expect(router.push).not.toHaveBeenCalled();
  });

  test('F5: each field stops at the server cap and says so under itself', () => {
    renderWithIntl(<OnboardingWizard />, { locale: 'ar-EG' });
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    expect([input('nameAr').maxLength, input('nameEn').maxLength, input('city').maxLength]).toEqual([200, 200, 120]);
    fireEvent.change(input('city'), { target: { value: 'ج'.repeat(120) } });
    const message = messageAt('ar-EG', 'onboarding.tooLong').replace('{max}', '120');
    expect(document.getElementById('city-error')?.textContent).toBe(message);
    expect(input('city').getAttribute('aria-invalid')).toBe('true');
  });

  test('F5: a value past the cap (a paste the input did not stop) is never sent', async () => {
    renderWithIntl(<OnboardingWizard />, { locale: 'en' });
    fireEvent.change(document.getElementById('nameAr')!, { target: { value: 'ا'.repeat(201) } });
    await act(async () => {
      fireEvent.submit(form());
    });
    expect(actions.createOrg).not.toHaveBeenCalled();
    expect(document.getElementById('nameAr-error')?.textContent).toBe(
      messageAt('en', 'errors.field.too_long').replace('{max}', '200'),
    );
  });
});
