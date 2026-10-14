// The rules the automation settings' two day counts keep: the DB CHECK ranges.
// Pure and client-safe: Settings runs them before sending, the core again.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { wholeNumberInRange } from '@/lib/validation/number-field-rules';

export const AUTOMATION_FIELDS = ['expireNudgeLeadDays', 'followupThresholdDays'] as const;

export type AutomationField = (typeof AUTOMATION_FIELDS)[number];

/** Each day count's inclusive range (the DB CHECKs); the boxes take the same bounds. */
export const AUTOMATION_DAY_BOUNDS: Readonly<Record<AutomationField, { min: number; max: number }>> = {
  expireNudgeLeadDays: { min: 1, max: 30 },
  followupThresholdDays: { min: 1, max: 90 },
};

/** Each day count out of its range, under its own box. */
export function automationFieldErrors(input: {
  expireNudgeLeadDays: number;
  followupThresholdDays: number;
}): FieldErrors<AutomationField> {
  const inRange = (field: AutomationField) =>
    wholeNumberInRange(input[field], AUTOMATION_DAY_BOUNDS[field].min, AUTOMATION_DAY_BOUNDS[field].max);
  return collectFieldErrors<AutomationField>({
    expireNudgeLeadDays: inRange('expireNudgeLeadDays'),
    followupThresholdDays: inRange('followupThresholdDays'),
  });
}

/** Which switch each day count belongs to. */
const SWITCH_OF: Readonly<Record<AutomationField, 'expireNudgeEnabled' | 'followupEnabled'>> = {
  expireNudgeLeadDays: 'expireNudgeEnabled',
  followupThresholdDays: 'followupEnabled',
};

/**
 * The day counts Save sends. A switched-off automation's count does not block
 * Save (its box is disabled, so a refusal there could never be fixed): when
 * what is in the box is out of range, the stored count is kept instead.
 */
export function automationDaysToSend(
  draft: Readonly<Record<AutomationField, string>> & Readonly<Record<'expireNudgeEnabled' | 'followupEnabled', boolean>>,
  stored: Readonly<Record<AutomationField, number>>,
): Record<AutomationField, number> {
  const daysOf = (field: AutomationField): number => {
    const typed = Number(draft[field]);
    if (draft[SWITCH_OF[field]]) return typed;
    const { min, max } = AUTOMATION_DAY_BOUNDS[field];
    return Number.isInteger(typed) && typed >= min && typed <= max ? typed : stored[field];
  };
  return { expireNudgeLeadDays: daysOf('expireNudgeLeadDays'), followupThresholdDays: daysOf('followupThresholdDays') };
}
