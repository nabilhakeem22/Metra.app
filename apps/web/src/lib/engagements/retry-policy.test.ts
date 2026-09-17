import { describe, expect, it } from 'vitest';
import type { ActionCode } from '@/lib/actions/result';
import { DEFINITE_REFUSALS, isDefiniteRefusal, releasesKey } from './retry-policy';

// The cockpit drops a held idempotency key ONLY on a definite refusal. These
// cases pin the default — hold — because that is the half that was inverted:
// the old rule cleared on everything but 'uncertain', so a lock timeout mapped
// to 'generic' minted a new key and spent a second free revision.

describe('isDefiniteRefusal', () => {
  it('is true for a coded refusal that proves the transaction rolled back', () => {
    expect(isDefiniteRefusal('forbidden')).toBe(true);
    expect(isDefiniteRefusal('illegal_trigger')).toBe(true);
    expect(isDefiniteRefusal('engagement_state_conflict')).toBe(true);
    expect(isDefiniteRefusal('engagement_not_found')).toBe(true);
    expect(isDefiniteRefusal('gate_b_not_cleared')).toBe(true);
    expect(isDefiniteRefusal('invalid')).toBe(true);
  });

  it('is false for every AMBIGUOUS answer — the key must be held', () => {
    expect(isDefiniteRefusal('uncertain')).toBe(false);
    // 'generic' is the one that mattered: an unmapped Postgres error arrives
    // here, and the first attempt may still commit.
    expect(isDefiniteRefusal('generic')).toBe(false);
  });

  it('holds on a code it has never heard of', () => {
    // A future ActionCode must fail SAFE. Holding a key that could have been
    // dropped costs nothing; dropping one that should have been held double-applies.
    expect(isDefiniteRefusal('a_code_added_next_quarter' as ActionCode)).toBe(false);
    expect(isDefiniteRefusal(undefined)).toBe(false);
  });

  it('never lists a code that means "we do not know"', () => {
    expect(DEFINITE_REFUSALS.has('uncertain')).toBe(false);
    expect(DEFINITE_REFUSALS.has('generic')).toBe(false);
  });
});

describe('releasesKey', () => {
  it('releases on success and on a definite refusal', () => {
    expect(releasesKey({ ok: true })).toBe(true);
    expect(releasesKey({ ok: false, error: 'illegal_trigger' })).toBe(true);
  });

  it('HOLDS on every ambiguous answer, including a rejection', () => {
    expect(releasesKey({ ok: false, error: 'uncertain' })).toBe(false);
    expect(releasesKey({ ok: false, error: 'generic' })).toBe(false);
    expect(releasesKey({ ok: false })).toBe(false);
    expect(releasesKey('rejected')).toBe(false);
  });
});
