import { describe, expect, it } from 'vitest';
import {
  PAYMENT_HELD_TRIGGER,
  actFrom,
  heldKeySlot,
  type HeldKeySlot,
} from './held-act';
import {
  HELD_KEY_TTL_MS,
  hasLanded,
  isHeldKeyLive,
  keyForAttempt,
  landedKeysOf,
  type HeldKey,
} from './held-key';
import { releasesKey } from './retry-policy';

const NOW = Date.parse('2026-09-17T10:00:00.000Z');
const mint = (key: string) => () => key;

function holding(slot: HeldKeySlot, key: string, heldAt: number) {
  return new Map<HeldKeySlot, HeldKey>([[slot, { key, heldAt }]]);
}

const REVISION = heldKeySlot('requestRevision');
const ATTESTATION = heldKeySlot('attestAsBuiltClean');

describe('keyForAttempt', () => {
  it('re-uses the key this TRIGGER is still holding, inside the window', () => {
    const held = holding(REVISION, 'held-key', NOW - 60_000);
    const attempt = keyForAttempt(held, REVISION, mint('fresh-key'), NOW);
    expect(attempt.key).toBe('held-key');
    // The RETRY KEEPS THE ORIGINAL INSTANT: the window bounds the act, not the
    // chain of retries, so a key cannot be walked forward indefinitely.
    expect(attempt.heldAt).toBe(NOW - 60_000);
  });

  it('mints a fresh key for a trigger holding nothing', () => {
    const held = holding(REVISION, 'held-key', NOW);
    const attempt = keyForAttempt(held, ATTESTATION, mint('fresh-key'), NOW);
    expect(attempt.key).toBe('fresh-key');
    expect(attempt.heldAt).toBe(NOW);
  });

  it('never reaches into the map for an edge that ignores the key', () => {
    // The upload, the note, the off-plan toggle. They pass no trigger, so they
    // can neither take nor release another act's key — which is the whole bug.
    const held = holding(REVISION, 'held-key', NOW);
    expect(keyForAttempt(held, undefined, mint('fresh-key'), NOW).key).toBe('fresh-key');
  });

  // R1: A9 gave the key the life of the TAB. The server reads it as proof of
  // sameness, so a genuinely new act at the same trigger later in the same tab
  // was answered "done" and the write was discarded.
  it('does NOT re-use a key past the window, even though the map still has it', () => {
    const held = holding(REVISION, 'held-key', NOW - HELD_KEY_TTL_MS - 1);
    const attempt = keyForAttempt(held, REVISION, mint('fresh-key'), NOW);
    expect(attempt.key).toBe('fresh-key');
    expect(attempt.heldAt).toBe(NOW);
  });

  it('re-uses it at exactly the window, and not one millisecond later', () => {
    const atCap = holding(REVISION, 'held-key', NOW - HELD_KEY_TTL_MS);
    expect(keyForAttempt(atCap, REVISION, mint('fresh'), NOW).key).toBe('held-key');
    const pastCap = holding(REVISION, 'held-key', NOW - HELD_KEY_TTL_MS - 1);
    expect(keyForAttempt(pastCap, REVISION, mint('fresh'), NOW).key).toBe('fresh');
  });

  it('describes the sequence that spent two free revisions', () => {
    // requestRevision is uncertain (key held) -> an UNRELATED action succeeds ->
    // the retry must still carry the original key. Under one shared ref the
    // success in the middle cleared it and the retry became a second act.
    const keys = new Map<HeldKeySlot, HeldKey>();
    const first = keyForAttempt(keys, REVISION, mint('first-key'), NOW);
    keys.set(REVISION, first);
    if (releasesKey({ ok: false, error: 'uncertain' })) keys.delete(REVISION);

    // The unrelated success: no slot, so it touches nothing.
    expect(keyForAttempt(keys, undefined, mint('upload-key'), NOW).key).toBe('upload-key');

    expect(keyForAttempt(keys, REVISION, mint('second-key'), NOW).key).toBe('first-key');
  });
});

/**
 * RT2 + F1: a payment is an act the control's NAME does not describe, and ONE
 * control can hold TWO acts in doubt at once. The act is part of the SLOT, so
 * `keyForAttempt` never has to compare it — it only ever reads its own entry.
 */
describe('keyForAttempt — one entry per ACT, not per control', () => {
  const slotFor = (amount: string) =>
    heldKeySlot(PAYMENT_HELD_TRIGGER, actFrom({ kind: 'deposit', amount }));
  const heldPayment = (amount: string) =>
    new Map<HeldKeySlot, HeldKey>([[slotFor(amount), { key: 'held-key', heldAt: NOW }]]);

  it('re-uses the key when the SAME act is retried inside the window', () => {
    const attempt = keyForAttempt(
      heldPayment('50000'),
      slotFor('50000'),
      mint('fresh-key'),
      NOW + 60_000,
    );
    expect(attempt.key).toBe('held-key');
    expect(attempt.heldAt).toBe(NOW);
  });

  it('mints a fresh key for a DIFFERENT amount at the same control', () => {
    const attempt = keyForAttempt(
      heldPayment('50000'),
      slotFor('75000'),
      mint('fresh-key'),
      NOW + 60_000,
    );
    expect(attempt.key).toBe('fresh-key');
  });

  // THE F1 REPRO, at the level of the map: the second act must not be able to
  // take the first act's entry, and settling the second must not remove it.
  it('leaves the first act HELD while a second act at the same control settles', () => {
    const held = heldPayment('50000');
    const second = keyForAttempt(held, slotFor('5o,ooo'), mint('second-key'), NOW + 60_000);
    held.set(slotFor('5o,ooo'), second);
    // The typo is definitely refused, so ITS entry is released — and only its.
    if (releasesKey({ ok: false, error: 'payment_amount_invalid' })) {
      held.delete(slotFor('5o,ooo'));
    }
    expect(keyForAttempt(held, slotFor('50000'), mint('third-key'), NOW + 120_000).key).toBe(
      'held-key',
    );
  });

  it('files the same act at two different controls separately', () => {
    const act = actFrom({ kind: 'deposit', amount: '50000' });
    expect(heldKeySlot('recordPayment', act)).not.toBe(
      heldKeySlot('logPaymentAndAdvance', act),
    );
  });

  it('a lifecycle trigger, which has no act, always files in the same slot', () => {
    expect(heldKeySlot('requestRevision')).toBe(heldKeySlot('requestRevision', undefined));
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

/**
 * RT1: this used to compare the BROWSER's `heldAt` against POSTGRES's
 * `decidedAt`, so a laptop running behind the server dropped a key that was
 * still live and the retry went out as a new act. It is an identity check now,
 * and the clocks cannot reach it.
 */
describe('hasLanded', () => {
  const entry: HeldKey = { key: 'held-key', heldAt: NOW };
  const landed = (...keys: string[]) => new Set(keys);

  it('is true when the ledger carries THIS key', () => {
    expect(hasLanded(entry, landed('other-key', 'held-key'))).toBe(true);
  });

  it('is false when it carries other keys, or none', () => {
    expect(hasLanded(entry, landed('other-key'))).toBe(false);
    expect(hasLanded(entry, landed())).toBe(false);
    expect(hasLanded(entry, undefined)).toBe(false);
    expect(hasLanded(undefined, landed('held-key'))).toBe(false);
  });

  it('IGNORES THE CLOCKS, in both directions', () => {
    // The browser ten minutes BEHIND the server, with a transition from an
    // earlier act at the same trigger: the old rule dropped this live key.
    const skewedBehind: HeldKey = { key: 'held-key', heldAt: NOW - 10 * 60_000 };
    expect(hasLanded(skewedBehind, landed('an-earlier-act'))).toBe(false);
    // And a browser AHEAD of the server does not hold a key the ledger carries.
    const skewedAhead: HeldKey = { key: 'held-key', heldAt: NOW + 10 * 60_000 };
    expect(hasLanded(skewedAhead, landed('held-key'))).toBe(true);
  });
});

describe('landedKeysOf', () => {
  it('collects every key the ledger carries, whatever order it arrives in', () => {
    const landed = landedKeysOf([
      { idempotencyKey: 'key-a' },
      { idempotencyKey: 'key-b' },
      { idempotencyKey: 'key-a' },
    ]);
    expect([...landed].sort()).toEqual(['key-a', 'key-b']);
  });

  it('ignores the rows that carry no key, and reports nothing for an empty ledger', () => {
    // Every edge that is not a self-loop, and every row written before 0050.
    expect(landedKeysOf([{ idempotencyKey: null }]).size).toBe(0);
    expect(landedKeysOf([]).size).toBe(0);
  });
});
