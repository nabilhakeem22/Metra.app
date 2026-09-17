import { describe, expect, it } from 'vitest';
import { TRANSITIONS } from './transitions';
import {
  PAYMENT_HELD_TRIGGER,
  PAY_AND_ADVANCE_HELD_TRIGGER,
  actFrom,
} from './held-act';

describe('the names a money control holds its key under', () => {
  it('are not lifecycle triggers, so neither can collide with one', () => {
    const triggers = Object.keys(TRANSITIONS);
    expect(triggers).not.toContain(PAYMENT_HELD_TRIGGER);
    expect(triggers).not.toContain(PAY_AND_ADVANCE_HELD_TRIGGER);
  });

  it('are two DIFFERENT names, so one control cannot overwrite the other', () => {
    // The map holds one entry per name. Sharing one would mean the hero form and
    // the Payments tab taking each other's key for an attempt still in doubt.
    expect(PAYMENT_HELD_TRIGGER).not.toBe(PAY_AND_ADVANCE_HELD_TRIGGER);
  });
});

describe('actFrom', () => {
  it('is the same string for the same values, whatever order they are written in', () => {
    expect(actFrom({ kind: 'deposit', amount: '50000' })).toBe(
      actFrom({ amount: '50000', kind: 'deposit' }),
    );
  });

  it('changes when ANY field changes', () => {
    const base = { kind: 'deposit', amount: '50000', method: null, reference: null };
    const of = (patch: Record<string, string | null>) => actFrom({ ...base, ...patch });
    expect(of({})).toBe(actFrom(base));
    expect(of({ amount: '75000' })).not.toBe(of({}));
    expect(of({ kind: 'gate_a' })).not.toBe(of({}));
    expect(of({ method: 'cash' })).not.toBe(of({}));
    expect(of({ reference: 'TRX-1' })).not.toBe(of({}));
  });

  it('treats null, undefined and an empty string as the same absence', () => {
    // An untouched optional field is `null` on one submit and `''` on another
    // depending on which branch trimmed it; neither is a different act.
    expect(actFrom({ method: null })).toBe(actFrom({ method: undefined }));
    expect(actFrom({ method: null })).toBe(actFrom({ method: '' }));
  });

  it('cannot be impersonated by a value that contains the separator', () => {
    // A joined string ('a=1|b=2') would make these two collide. They must not.
    expect(actFrom({ a: '1', b: '2' })).not.toBe(actFrom({ a: '1|b=2' }));
    expect(actFrom({ a: '1", "b' })).not.toBe(actFrom({ a: '1', b: '' }));
  });

  it('caps each value, so a pasted essay cannot be carried into storage', () => {
    const long = actFrom({ note: 'x'.repeat(5_000) });
    expect(long.length).toBeLessThan(100);
    // and two values that differ only past the cap are then the same act — both
    // are far beyond anything the server accepts, so both are refused anyway.
    expect(actFrom({ note: 'x'.repeat(5_000) })).toBe(actFrom({ note: 'x'.repeat(6_000) }));
  });

  it('distinguishes values that differ INSIDE the cap', () => {
    expect(actFrom({ amount: '50000.0000' })).not.toBe(actFrom({ amount: '50000.0001' }));
  });
});
