import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { ORG_PROFILE_FIELDS } from '@/lib/org/profile-field-rules';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { SettingsClient } from './settings-client';
import { profileControlId } from './settings-profile-card';

const actions = vi.hoisted(() => ({ updateOrgProfile: vi.fn(), updateOrgSettings: vi.fn() }));
vi.mock('@/lib/org/actions', () => actions);
vi.mock('@/lib/org/upload-org-logo', () => ({ uploadOrgLogo: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const INITIAL = {
  nameEn: 'Nile Studio',
  nameAr: '',
  city: '',
  taxRegistrationNumber: '',
  hideMarginFromPm: false,
  restrictFirmDashboard: false,
};

function renderSettings(locale: TestLocale) {
  document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
  renderWithIntl(<SettingsClient canManage initial={INITIAL} savedLogoId={null} />, { locale });
}

async function saveProfile(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: messageAt(locale, 'settings.save') })[0]!);
  });
}

beforeEach(() => {
  actions.updateOrgProfile.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('Settings profile (%s)', (locale) => {
  test('every field the server refuses is said under its own control (AC 19)', async () => {
    renderSettings(locale);
    await expectFieldErrorsRenderUnderFields({
      fields: ORG_PROFILE_FIELDS,
      controlIdOf: profileControlId,
      answerWith: (result: ActionResult) => actions.updateOrgProfile.mockResolvedValue(result),
      submit: () => saveProfile(locale),
      locale,
      typed: { 'org-nameEn': 'Nile Studio' },
    });
    expect(toast).not.toHaveBeenCalled();
  });

  test('both names cleared: nothing is sent and the name is asked for under the English name', async () => {
    renderSettings(locale);
    fireEvent.change(document.getElementById('org-nameEn')!, { target: { value: '  ' } });
    await saveProfile(locale);
    expect(actions.updateOrgProfile).not.toHaveBeenCalled();
    expect(document.getElementById('org-nameEn-error')?.textContent).toBe(messageAt(locale, 'errors.name_required'));
    expect(document.getElementById('org-nameAr')?.getAttribute('aria-describedby')).toContain('org-nameEn-error');
    expect(document.activeElement?.id).toBe('org-nameEn');
  });

  test('a refusal no field owns is said under Save, not in a toast', async () => {
    actions.updateOrgProfile.mockResolvedValue({ ok: false, error: 'generic', reference: 'K7Q29MXD' });
    renderSettings(locale);
    await saveProfile(locale);
    expect(screen.getByRole('alert').textContent).toContain('K7Q29MXD');
    expect(toast).not.toHaveBeenCalled();
  });
});
