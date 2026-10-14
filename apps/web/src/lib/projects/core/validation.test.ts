import { describe, expect, it } from 'vitest';
import type { ProjectInput } from '../fields';
import { isErr, validate } from './validation';

const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const BASE: ProjectInput = {
  nameEn: 'Tower fit-out',
  clientId: CLIENT_ID,
  status: 'active',
  startDate: '2026-01-01',
};

describe('validate (projects)', () => {
  it('a create without an end date passes', () => {
    expect(isErr(validate(BASE, { requireStartDate: true }))).toBe(false);
  });

  it('a create without a start date is refused under the start date', () => {
    expect(validate({ ...BASE, startDate: null }, { requireStartDate: true })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { startDate: { code: 'start_date_required' } },
    });
  });

  it('an end date before the start is refused under the end date', () => {
    expect(validate({ ...BASE, endDate: '2025-12-31' }, { requireStartDate: true })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { endDate: { code: 'invalid_dates' } },
    });
  });

  it('a date that names no real day, or a control character, is refused under its field (F15)', () => {
    expect(
      validate(
        { ...BASE, startDate: '2026-02-30', endDate: '12026-01-01', city: 'Cairo\u0000', country: 'Egypt\u0007' },
        { requireStartDate: true },
      ),
    ).toEqual({
      ok: false,
      error: 'check_fields',
      fields: {
        startDate: { code: 'invalid_date' },
        endDate: { code: 'invalid_date' },
        city: { code: 'unprintable' },
        country: { code: 'unprintable' },
      },
    });
  });

  it('says every broken rule at once (D1)', () => {
    const result = validate(
      { ...BASE, nameEn: ' ', clientId: '', startDate: null, notes: 'x'.repeat(2001), advancePct: '101' },
      { requireStartDate: true },
    );
    expect(result).toEqual({
      ok: false,
      error: 'check_fields',
      fields: {
        name: { code: 'name_required' },
        clientId: { code: 'client_required' },
        startDate: { code: 'start_date_required' },
        notes: { code: 'too_long', params: { max: 2000 } },
        advancePct: { code: 'out_of_range', params: { min: 0, max: 100 } },
      },
    });
  });

  it('a status or type id no form can send is malformed; an edit without dates is fine', () => {
    expect(validate({ ...BASE, status: undefined, startDate: null })).toEqual({ ok: false, error: 'malformed' });
    expect(validate({ ...BASE, typeId: 'not-a-uuid' })).toEqual({ ok: false, error: 'malformed' });
    expect(isErr(validate({ ...BASE, startDate: null }))).toBe(false);
  });

  it('an update without its stored code is refused under the code', () => {
    expect(validate(BASE, { requireCode: true })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { code: { code: 'code_required' } },
    });
  });
});
