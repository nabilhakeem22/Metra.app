import { describe, expect, it, vi } from 'vitest';
import { isErr, validate, type ProjectInput } from './validation';

// `validate` is pure; the module also holds the in-tx client check, whose
// `fail` import reaches the server-only mutate stack.
vi.mock('@/lib/actions/mutate', () => ({ fail: vi.fn() }));

const CLIENT_ID = '33333333-3333-4333-8333-333333333333';
const BASE: ProjectInput = {
  nameEn: 'Tower fit-out',
  clientId: CLIENT_ID,
  status: 'active',
  startDate: '2026-01-01',
};

describe('validate (projects)', () => {
  it('a create without an end date passes', () => {
    const v = validate(BASE, { requireStartDate: true });
    expect(isErr(v)).toBe(false);
  });

  it('a create without a start date is start_date_required', () => {
    expect(validate({ ...BASE, startDate: null }, { requireStartDate: true })).toEqual({
      ok: false,
      error: 'start_date_required',
    });
  });

  it('keeps the order check when both dates are present', () => {
    expect(
      validate({ ...BASE, endDate: '2025-12-31' }, { requireStartDate: true }),
    ).toEqual({ ok: false, error: 'invalid_dates' });
  });

  it('an update without a status is invalid; without dates it is fine', () => {
    expect(validate({ ...BASE, status: undefined, startDate: null })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(isErr(validate({ ...BASE, startDate: null }))).toBe(false);
  });
});
