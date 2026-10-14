'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import {
  AUTOMATION_FIELDS,
  automationDaysToSend,
  automationFieldErrors,
} from '@/lib/automation/settings-field-rules';
import { updateAutomationSettings, type AutomationSettingsInput } from '@/lib/automation/settings-actions';

/** The automation settings as the card holds them: the day counts as typed. */
export interface AutomationDraft extends Omit<AutomationSettingsInput, 'expireNudgeLeadDays' | 'followupThresholdDays'> {
  expireNudgeLeadDays: string;
  followupThresholdDays: string;
}

/**
 * The automation card's state and Save. A day count out of its range is said
 * under its box before anything is sent, but only while its automation is on;
 * a refusal no box owns, under Save.
 */
export function useAutomationForm(initial: AutomationSettingsInput) {
  const ts = useTranslations('settings');
  const te = useTranslations('errors');
  const [saving, startSaving] = useTransition();
  const [draft, setDraft] = useState<AutomationDraft>({
    ...initial,
    expireNudgeLeadDays: String(initial.expireNudgeLeadDays),
    followupThresholdDays: String(initial.followupThresholdDays),
  });
  const errors = useFieldErrors({ fields: AUTOMATION_FIELDS, translate: te });

  function set<K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    const input: AutomationSettingsInput = { ...draft, ...automationDaysToSend(draft, initial) };
    if (errors.applyLocal(automationFieldErrors(input))) return;
    startSaving(async () => {
      try {
        const result = await updateAutomationSettings(input);
        if (!errors.applyResult(result)) toast({ title: ts('saved') });
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { draft, set, save, saving, errors };
}
