import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { AUTOMATION_FIELDS } from '@/lib/automation/settings-field-rules';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { AutomationSettingsClient } from './automation-settings-client';

const actions = vi.hoisted(() => ({ updateAutomationSettings: vi.fn() }));
vi.mock('@/lib/automation/settings-actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

const INITIAL = {
  expireEnabled: true,
  expireNudgeEnabled: true,
  expireNudgeLeadDays: 3,
  followupEnabled: true,
  followupThresholdDays: 7,
  digestEnabled: false,
  digestCadence: 'weekly',
  stageRemindersEnabled: false,
};

async function save(locale: TestLocale) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: messageAt(locale, 'settings.save') }));
  });
}

beforeEach(() => {
  actions.updateAutomationSettings.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('AutomationSettingsClient (%s)', (locale) => {
  test('a day count out of its range is said under its box and nothing is sent', async () => {
    renderWithIntl(<AutomationSettingsClient canManage initial={INITIAL} />, { locale });
    fireEvent.change(document.getElementById('followupThresholdDays')!, { target: { value: '120' } });
    await save(locale);
    expect(actions.updateAutomationSettings).not.toHaveBeenCalled();
    expect(document.getElementById('followupThresholdDays-error')?.textContent).toBe(
      messageAt(locale, 'errors.field.out_of_range').replace('{min}', '1').replace('{max}', '90'),
    );
    expect(document.activeElement?.id).toBe('followupThresholdDays');
  });

  test('every box the server refuses is said under it (AC 19)', async () => {
    renderWithIntl(<AutomationSettingsClient canManage initial={INITIAL} />, { locale });
    await expectFieldErrorsRenderUnderFields({
      fields: AUTOMATION_FIELDS,
      controlIdOf: (field) => field,
      answerWith: (result: ActionResult) => actions.updateAutomationSettings.mockResolvedValue(result),
      submit: () => save(locale),
      locale,
      typed: { expireNudgeLeadDays: '3', followupThresholdDays: '7' },
    });
    expect(toast).not.toHaveBeenCalled();
  });
});
