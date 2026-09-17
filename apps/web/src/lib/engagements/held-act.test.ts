import { describe, expect, it } from 'vitest';
import { TRANSITIONS } from './transitions';
import {
  PAYMENT_HELD_TRIGGER,
  PAY_AND_ADVANCE_HELD_TRIGGER,
  actFrom,
  actOf,
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

  it('cannot be impersonated by a value that contains a separator', () => {
    // A joined string ('a=1|b=2') would make these two collide. They must not.
    expect(actFrom({ a: '1', b: '2' })).not.toBe(actFrom({ a: '1|b=2' }));
    expect(actFrom({ a: '1", "b' })).not.toBe(actFrom({ a: '1', b: '' }));
  });

  // F3: the act used to be the first 40 characters of each value, and the server
  // accepts 200 for `reference` and `method` — so two wire references from one
  // bank on one day were ONE act and the second payment was answered with the
  // first one's row. These are the re-test's exact strings.
  it('distinguishes two bank references that differ only at character 41', () => {
    const wire = (sequence: string) => ({
      kind: 'deposit',
      amount: '50000',
      method: 'bank',
      reference: `EGY-NBE-WIRE-2026-09-17-BRANCH-014-SEQ-${sequence}`,
    });
    expect(wire('0001').reference.length).toBeGreaterThan(40);
    expect(actFrom(wire('0001'))).not.toBe(actFrom(wire('0002')));
  });

  it('distinguishes two 41-digit amounts, which MONEY_RE does accept', () => {
    // No studio types these; the regex has no length bound, so the fingerprint
    // must not be where that bound is quietly imposed.
    expect(actFrom({ amount: `${'0'.repeat(40)}1` })).not.toBe(
      actFrom({ amount: `${'0'.repeat(40)}2` }),
    );
  });

  it('is sixteen hex characters whatever the input is', () => {
    const short = actFrom({ a: '' });
    const long = actFrom({ note: 'x'.repeat(50_000), reference: 'y'.repeat(5_000) });
    expect(short).toMatch(/^[0-9a-f]{16}$/);
    expect(long).toMatch(/^[0-9a-f]{16}$/);
    expect(short).not.toBe(long);
  });

  it('reads the WHOLE value, however long', () => {
    const essay = 'x'.repeat(5_000);
    expect(actFrom({ note: `${essay}a` })).not.toBe(actFrom({ note: `${essay}b` }));
  });

  it('distinguishes values that differ by one character anywhere', () => {
    expect(actFrom({ amount: '50000.0000' })).not.toBe(actFrom({ amount: '50000.0001' }));
  });

  // PINNED TO LITERALS, because "the same act" has to mean the same thing in
  // every build: a key held in an open tab at the moment of a deploy must still
  // match its own act afterwards. This reds on any change to the canonical form
  // OR to the hash — FNV-1a/64 over the UTF-8 bytes, whose own reference vectors
  // ('' -> cbf29ce484222325, 'a' -> af63dc4c8601ec8c) this implementation
  // reproduces.
  it('is stable across builds, pinned to its output', () => {
    expect(actFrom({ kind: 'deposit', amount: '50000' })).toBe('80434ce69bb98586');
    expect(actFrom({ amount: '50000', kind: 'deposit' })).toBe('80434ce69bb98586');
    expect(actFrom({})).toBe('09612b07b5ecb5a5');
  });
});

/**
 * F5: the fingerprint is tied to the request type, so "pass EVERY field" is a
 * compile error rather than a comment. The guard is `@ts-expect-error` — the tsc
 * gate reds on an UNUSED one, so the day the coupling stops working this line
 * fails the build rather than going quietly green.
 */
describe('actOf', () => {
  interface Request {
    amount: string;
    /** Optional on the request, MANDATORY in the act — see ActFieldsOf. */
    note?: string | null;
  }

  it('does not compile when a field of the request type is missing', () => {
    // @ts-expect-error — 'note' is missing: exactly the omission that swallows a
    // payment silently when nothing checks it.
    const missing = actOf<Request>({ amount: '50000' });
    expect(missing).toMatch(/^[0-9a-f]{16}$/);
  });

  it('accepts the complete field set, and an unsent field named as undefined', () => {
    const named = actOf<Request>({ amount: '50000', note: undefined });
    expect(named).toBe(actFrom({ amount: '50000', note: undefined }));
    expect(named).not.toBe(actOf<Request>({ amount: '50000', note: 'late fee' }));
  });
});
