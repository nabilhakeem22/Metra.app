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
