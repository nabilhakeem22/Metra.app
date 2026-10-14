import { describe, expect, it } from 'vitest';
import { automationFieldErrors } from './settings-field-rules';

describe('automationFieldErrors', () => {
  it('says each day count out of its range under its own box, with the range', () => {
    expect(automationFieldErrors({ expireNudgeLeadDays: 3, followupThresholdDays: 7 })).toEqual({});
    expect(automationFieldErrors({ expireNudgeLeadDays: 0, followupThresholdDays: 2.5 })).toEqual({
      expireNudgeLeadDays: { code: 'out_of_range', params: { min: 1, max: 30 } },
      followupThresholdDays: { code: 'out_of_range', params: { min: 1, max: 90 } },
    });
    expect(automationFieldErrors({ expireNudgeLeadDays: Number.NaN, followupThresholdDays: 91 })).toEqual({
      expireNudgeLeadDays: { code: 'out_of_range', params: { min: 1, max: 30 } },
      followupThresholdDays: { code: 'out_of_range', params: { min: 1, max: 90 } },
    });
  });
});
