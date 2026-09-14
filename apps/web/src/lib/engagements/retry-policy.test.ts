import { describe, expect, it } from 'vitest';
import type { ActionCode } from '@/lib/actions/result';
import type { Trigger } from './transitions';
import {
  DEFINITE_REFUSALS,
  isDefiniteRefusal,
  keyForAttempt,
  releasesKey,
} from './retry-policy';

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

describe('keyForAttempt', () => {
  const mint = () => 'fresh-key';
  const held = new Map<Trigger, string>([['requestRevision', 'held-key']]);

  it('re-uses the key this TRIGGER is still holding', () => {
    expect(keyForAttempt(held, 'requestRevision', mint)).toBe('held-key');
  });

  it('mints a fresh key for a trigger holding nothing', () => {
    expect(keyForAttempt(held, 'attestAsBuiltClean', mint)).toBe('fresh-key');
  });

  it('never reaches into the map for an edge that ignores the key', () => {
    // The upload, the note, the off-plan toggle. They pass no trigger, so they
    // can neither take nor release another act's key — which is the whole bug.
    expect(keyForAttempt(held, undefined, mint)).toBe('fresh-key');
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

  it('describes the sequence that spent two free revisions', () => {
    // requestRevision is uncertain (key held) -> an UNRELATED action succeeds ->
    // the retry must still carry the original key. Under one shared ref the
    // success in the middle cleared it and the retry became a second act.
    const keys = new Map<Trigger, string>();
    const mint = () => 'first-key';
    const first = keyForAttempt(keys, 'requestRevision', mint);
    keys.set('requestRevision', first);
    if (releasesKey({ ok: false, error: 'uncertain' })) keys.delete('requestRevision');

    // The unrelated success: no trigger, so it touches nothing.
    expect(keyForAttempt(keys, undefined, () => 'upload-key')).toBe('upload-key');

    expect(keyForAttempt(keys, 'requestRevision', () => 'second-key')).toBe('first-key');
  });
});
