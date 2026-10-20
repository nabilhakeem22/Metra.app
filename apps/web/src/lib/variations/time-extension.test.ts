import { describe, expect, it } from 'vitest';
import { extensionDaysWording, readTimeExtensionDays, timeExtensionFieldErrors } from './time-extension';

const RANGE = { code: 'out_of_range', params: { min: 0, max: 3650 } };

describe('readTimeExtensionDays', () => {
  it('a blank box, null or an absent value is no extension', () => {
    for (const blank of ['', '   ', null, undefined]) {
      expect(readTimeExtensionDays(blank)).toEqual({ ok: true, value: null });
    }
  });

  it('reads whole days from 0 to 3650, typed or as a number', () => {
    expect(readTimeExtensionDays('0')).toEqual({ ok: true, value: 0 });
    expect(readTimeExtensionDays(' 15 ')).toEqual({ ok: true, value: 15 });
    expect(readTimeExtensionDays('3650')).toEqual({ ok: true, value: 3650 });
    expect(readTimeExtensionDays(30)).toEqual({ ok: true, value: 30 });
  });

  it('refuses a minus or past 3650 with the range', () => {
    for (const outside of ['-1', '3651', '99999999999', -3]) {
      expect(readTimeExtensionDays(outside)).toEqual({ ok: false, error: RANGE });
    }
  });

  it('refuses a fraction by saying the days must be whole (F5), even inside the range', () => {
    for (const fraction of ['1.5', '-1.5', '0.1', 2.5]) {
      expect(readTimeExtensionDays(fraction)).toEqual({ ok: false, error: { code: 'not_whole_number' } });
    }
    expect(readTimeExtensionDays('15.0')).toEqual({ ok: true, value: 15 });
  });

  it('refuses what is not a number, including Arabic-Indic digits the form did not convert', () => {
    for (const junk of ['abc', '1,5', '1e3', '١٥', 'NaN', Number.NaN, Number.POSITIVE_INFINITY, true, {}, ['3']]) {
      expect(readTimeExtensionDays(junk)).toEqual({ ok: false, error: { code: 'not_a_number' } });
    }
  });
});

describe('timeExtensionFieldErrors', () => {
  it('puts the refusal under the box, and nothing when the value reads', () => {
    expect(timeExtensionFieldErrors('12')).toEqual({});
    expect(timeExtensionFieldErrors('')).toEqual({});
    expect(timeExtensionFieldErrors('4000')).toEqual({ timeExtensionDays: RANGE });
  });
});

describe('extensionDaysWording (F2)', () => {
  it('an approved order adds its days; an open one would; a rejected one says nothing', () => {
    expect(extensionDaysWording('approved', 15)).toBe('adds');
    for (const open of ['draft', 'internal_approved', 'issued']) expect(extensionDaysWording(open, 15)).toBe('wouldAdd');
    expect(extensionDaysWording('rejected', 15)).toBeNull();
  });

  it('no days, or zero, says nothing whatever the status', () => {
    expect(extensionDaysWording('approved', 0)).toBeNull();
    expect(extensionDaysWording('issued', null)).toBeNull();
  });
});
