import { describe, expect, it } from 'vitest';
import { TRANSITIONS, type Trigger } from './transitions';
import {
  HELD_KEY_TTL_MS,
  PAYMENT_HELD_TRIGGER,
  hasLanded,
  isHeldKeyLive,
  keyForAttempt,
  latestTransitionAtByTrigger,
  type HeldKey,
  type HeldKeyTrigger,
} from './held-key';
import { releasesKey } from './retry-policy';

const NOW = Date.parse('2026-09-17T10:00:00.000Z');
const mint = (key: string) => () => key;

function holding(trigger: Trigger, key: string, heldAt: number) {
  return new Map<Trigger, HeldKey>([[trigger, { key, heldAt }]]);
}

describe('keyForAttempt', () => {
  it('re-uses the key this TRIGGER is still holding, inside the window', () => {
    const held = holding('requestRevision', 'held-key', NOW - 60_000);
    const attempt = keyForAttempt(held, 'requestRevision', mint('fresh-key'), NOW);
    expect(attempt.key).toBe('held-key');
    // The RETRY KEEPS THE ORIGINAL INSTANT: the window bounds the act, not the
    // chain of retries, so a key cannot be walked forward indefinitely.
    expect(attempt.heldAt).toBe(NOW - 60_000);
  });

  it('mints a fresh key for a trigger holding nothing', () => {
    const held = holding('requestRevision', 'held-key', NOW);
    const attempt = keyForAttempt(held, 'attestAsBuiltClean', mint('fresh-key'), NOW);
    expect(attempt.key).toBe('fresh-key');
    expect(attempt.heldAt).toBe(NOW);
  });

  it('never reaches into the map for an edge that ignores the key', () => {
    // The upload, the note, the off-plan toggle. They pass no trigger, so they
    // can neither take nor release another act's key — which is the whole bug.
    const held = holding('requestRevision', 'held-key', NOW);
    expect(keyForAttempt(held, undefined, mint('fresh-key'), NOW).key).toBe('fresh-key');
  });

  // R1: A9 gave the key the life of the TAB. The server reads it as proof of
  // sameness, so a genuinely new act at the same trigger later in the same tab
  // was answered "done" and the write was discarded.
  it('does NOT re-use a key past the window, even though the map still has it', () => {
    const held = holding('requestRevision', 'held-key', NOW - HELD_KEY_TTL_MS - 1);
    const attempt = keyForAttempt(held, 'requestRevision', mint('fresh-key'), NOW);
    expect(attempt.key).toBe('fresh-key');
    expect(attempt.heldAt).toBe(NOW);
  });

  it('re-uses it at exactly the window, and not one millisecond later', () => {
    const atCap = holding('requestRevision', 'held-key', NOW - HELD_KEY_TTL_MS);
    expect(keyForAttempt(atCap, 'requestRevision', mint('fresh'), NOW).key).toBe('held-key');
    const pastCap = holding('requestRevision', 'held-key', NOW - HELD_KEY_TTL_MS - 1);
    expect(keyForAttempt(pastCap, 'requestRevision', mint('fresh'), NOW).key).toBe('fresh');
  });

  it('describes the sequence that spent two free revisions', () => {
    // requestRevision is uncertain (key held) -> an UNRELATED action succeeds ->
    // the retry must still carry the original key. Under one shared ref the
    // success in the middle cleared it and the retry became a second act.
    const keys = new Map<Trigger, HeldKey>();
    const first = keyForAttempt(keys, 'requestRevision', mint('first-key'), NOW);
    keys.set('requestRevision', first);
    if (releasesKey({ ok: false, error: 'uncertain' })) keys.delete('requestRevision');

    // The unrelated success: no trigger, so it touches nothing.
    expect(keyForAttempt(keys, undefined, mint('upload-key'), NOW).key).toBe('upload-key');

    expect(keyForAttempt(keys, 'requestRevision', mint('second-key'), NOW).key).toBe(
      'first-key',
    );
  });
});

/**
 * RT2: a payment is an act the trigger's NAME does not describe — the studio can
 * log two genuinely different payments through one control. `act` is what makes
 * the second one a second act.
 */
describe('keyForAttempt — the act, where the trigger does not name it', () => {
  const heldPayment = (act: string) =>
    new Map<HeldKeyTrigger, HeldKey>([
      [PAYMENT_HELD_TRIGGER, { key: 'held-key', heldAt: NOW, act }],
    ]);

  it('re-uses the key when the SAME act is retried inside the window', () => {
    const attempt = keyForAttempt(
      heldPayment('deposit|50000'),
      PAYMENT_HELD_TRIGGER,
      mint('fresh-key'),
      NOW + 60_000,
      'deposit|50000',
    );
    expect(attempt.key).toBe('held-key');
    expect(attempt.heldAt).toBe(NOW);
  });

  it('mints a fresh key for a DIFFERENT amount at the same trigger', () => {
    const attempt = keyForAttempt(
      heldPayment('deposit|50000'),
      PAYMENT_HELD_TRIGGER,
      mint('fresh-key'),
      NOW + 60_000,
      'deposit|75000',
    );
    expect(attempt.key).toBe('fresh-key');
    expect(attempt.act).toBe('deposit|75000');
  });

  it('mints a fresh key for a different KIND at the same amount', () => {
    expect(
      keyForAttempt(
        heldPayment('deposit|50000'),
        PAYMENT_HELD_TRIGGER,
        mint('fresh-key'),
        NOW,
        'gate_a|50000',
      ).key,
    ).toBe('fresh-key');
  });

  it('does not let an act-less entry answer for an act, or the reverse', () => {
    // A stored entry from a build that named no act cannot stand in for one, and
    // a lifecycle trigger (which passes none) cannot pick up a payment's.
    const actless = new Map<HeldKeyTrigger, HeldKey>([
      [PAYMENT_HELD_TRIGGER, { key: 'held-key', heldAt: NOW }],
    ]);
    expect(
      keyForAttempt(actless, PAYMENT_HELD_TRIGGER, mint('fresh'), NOW, 'deposit|50000').key,
    ).toBe('fresh');
    const paid = heldPayment('deposit|50000');
    expect(keyForAttempt(paid, PAYMENT_HELD_TRIGGER, mint('fresh'), NOW).key).toBe('fresh');
  });

  it('is not a lifecycle trigger, so it can never collide with one', () => {
    expect(Object.keys(TRANSITIONS)).not.toContain(PAYMENT_HELD_TRIGGER);
  });
});

describe('isHeldKeyLive', () => {
  it('is fifteen minutes, stated once', () => {
    expect(HELD_KEY_TTL_MS).toBe(15 * 60 * 1000);
  });

  it('holds inside the window and lets go outside it', () => {
    expect(isHeldKeyLive({ key: 'k', heldAt: NOW }, NOW)).toBe(true);
    expect(isHeldKeyLive({ key: 'k', heldAt: NOW - 14 * 60_000 }, NOW)).toBe(true);
    expect(isHeldKeyLive({ key: 'k', heldAt: NOW - 16 * 60_000 }, NOW)).toBe(false);
  });
});

describe('hasLanded', () => {
  const entry: HeldKey = { key: 'held-key', heldAt: NOW };

  it('is true when the engagement recorded that act AFTER the attempt', () => {
    expect(hasLanded(entry, NOW + 1_000)).toBe(true);
  });

  it('is false for a transition that predates the attempt', () => {
    // Somebody else's earlier act at the same trigger says nothing about ours.
    expect(hasLanded(entry, NOW - 1_000)).toBe(false);
  });

  it('HOLDS on a tie, and on a trigger with no transition at all', () => {
    // Two clocks (the browser and Postgres). Wrongly holding a key costs
    // nothing; wrongly dropping one is the double-apply.
    expect(hasLanded(entry, NOW)).toBe(false);
    expect(hasLanded(entry, undefined)).toBe(false);
    expect(hasLanded(undefined, NOW + 1_000)).toBe(false);
  });
});

describe('latestTransitionAtByTrigger', () => {
  const at = (iso: string) => new Date(iso);

  it('takes the NEWEST row per trigger, whatever order the ledger arrives in', () => {
    const latest = latestTransitionAtByTrigger([
      { trigger: 'requestRevision', decidedAt: at('2026-09-17T09:00:00.000Z') },
      { trigger: 'requestRevision', decidedAt: at('2026-09-17T11:00:00.000Z') },
      { trigger: 'approveDesign', decidedAt: at('2026-09-17T10:00:00.000Z') },
    ]);
    expect(latest.get('requestRevision')).toBe(Date.parse('2026-09-17T11:00:00.000Z'));
    expect(latest.get('approveDesign')).toBe(Date.parse('2026-09-17T10:00:00.000Z'));
  });

  it('skips the rows that name no trigger, and reports nothing for an empty ledger', () => {
    // A correction row carries a null trigger; it is not an act anyone retries.
    const latest = latestTransitionAtByTrigger([
      { trigger: null, decidedAt: at('2026-09-17T12:00:00.000Z') },
    ]);
    expect(latest.size).toBe(0);
    expect(latestTransitionAtByTrigger([]).size).toBe(0);
  });
});
