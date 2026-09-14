import { describe, expect, it } from 'vitest';
import { mapDocumentSdfCode, mapSignalSdfCode } from './sdf-result';

// Five switch statements collapse into these two. The split is the point: the
// SAME SDF code means opposite things on the two kinds of surface, and that is
// what the copies got right by accident and could have got wrong by edit.

describe('mapDocumentSdfCode — proposal, contract, variation', () => {
  it('passes ok through', () => {
    expect(mapDocumentSdfCode('ok')).toEqual({ ok: true });
  });

  it('treats a SECOND response as a failure', () => {
    // The client already decided. Reporting success would tell them their second
    // click did something when it did not.
    expect(mapDocumentSdfCode('already')).toEqual({
      ok: false,
      error: 'already_responded',
    });
  });

  it('maps every code the three document SDFs can return', () => {
    expect(mapDocumentSdfCode('expired')).toEqual({ ok: false, error: 'token_expired' });
    expect(mapDocumentSdfCode('contract_inactive')).toEqual({
      ok: false,
      error: 'contract_inactive',
    });
  });
});

describe('mapSignalSdfCode — the delivery portal', () => {
  it('passes ok through', () => {
    expect(mapSignalSdfCode('ok')).toEqual({ ok: true });
  });

  it('treats a SECOND submit as an idempotent SUCCESS', () => {
    // An advisory signal is already recorded; nothing is wrong. A double-tap on a
    // phone must not read to the client as an error.
    expect(mapSignalSdfCode('already')).toEqual({ ok: true, code: 'already' });
  });

  it('maps every code the two signal SDFs can return', () => {
    expect(mapSignalSdfCode('expired')).toEqual({ ok: false, error: 'token_expired' });
    expect(mapSignalSdfCode('not_active')).toEqual({ ok: false, error: 'not_active' });
    expect(mapSignalSdfCode('wrong_state')).toEqual({ ok: false, error: 'wrong_state' });
  });
});

describe('both mappers degrade to token_invalid', () => {
  it('answers an unknown or absent code with "this link does not work"', () => {
    // A code a newer SDF starts returning before the app that reads it ships must
    // not reach the client as a blank screen.
    for (const code of [undefined, '', 'something_new', 'OK', 'Already']) {
      expect(mapDocumentSdfCode(code)).toEqual({ ok: false, error: 'token_invalid' });
      expect(mapSignalSdfCode(code)).toEqual({ ok: false, error: 'token_invalid' });
    }
  });

  it('is not fooled by an inherited object property', () => {
    // A lookup object would answer 'constructor' with a function; the switch does not.
    for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(mapDocumentSdfCode(code)).toEqual({ ok: false, error: 'token_invalid' });
      expect(mapSignalSdfCode(code)).toEqual({ ok: false, error: 'token_invalid' });
    }
  });
});
