import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELD_KEY_TTL_MS, type HeldKey } from '@/lib/engagements/held-key';
import type { Trigger } from '@/lib/engagements/transitions';
import { heldKeysStorageKey, readHeldKeys, writeHeldKeys } from './held-keys-store';

// A node test, not a .test.tsx: this module touches `sessionStorage` and nothing
// else, so a real DOM would buy nothing and cost the whole happy-dom environment.
// The double records what it was asked to do, which is half of what is asserted
// here — an expired entry must be ERASED, not merely ignored on the way past.
const ops: string[] = [];
let store: Record<string, string> = {};

const sessionStorageDouble = {
  getItem: (name: string) => {
    ops.push(`get ${name}`);
    return store[name] ?? null;
  },
  setItem: (name: string, value: string) => {
    ops.push(`set ${name}`);
    store[name] = value;
  },
  removeItem: (name: string) => {
    ops.push(`remove ${name}`);
    delete store[name];
  },
};

const NOW = Date.parse('2026-09-17T10:00:00.000Z');
const NAME = heldKeysStorageKey('e-1');
// A stored key must be UUID-SHAPED (S1): it is handed to a server action as the
// idempotency key, and the cores refuse anything else with a coded `invalid`.
const KEY_1 = '11111111-1111-4111-8111-111111111111';
const KEY_2 = '22222222-2222-4222-8222-222222222222';

function put(record: Record<string, unknown>): void {
  store[NAME] = JSON.stringify(record);
}

function held(entries: [Trigger, HeldKey][]): Map<Trigger, HeldKey> {
  return new Map(entries);
}

beforeEach(() => {
  ops.length = 0;
  store = {};
  vi.stubGlobal('sessionStorage', sessionStorageDouble);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('writeHeldKeys', () => {
  it('mirrors the map under a per-engagement name, instants and all', () => {
    writeHeldKeys('e-1', held([['requestRevision', { key: KEY_1, heldAt: NOW }]]));
    expect(JSON.parse(store[NAME]!)).toEqual({
      requestRevision: { key: KEY_1, heldAt: NOW },
    });
    expect(store[heldKeysStorageKey('e-2')]).toBeUndefined();
  });

  it('REMOVES the entry once nothing is held', () => {
    put({ requestRevision: { key: KEY_1, heldAt: NOW } });
    writeHeldKeys('e-1', held([]));
    expect(store[NAME]).toBeUndefined();
    expect(ops).toContain(`remove ${NAME}`);
  });
});

describe('readHeldKeys', () => {
  it('reads back what was written', () => {
    writeHeldKeys('e-1', held([['requestRevision', { key: KEY_1, heldAt: NOW }]]));
    expect(readHeldKeys('e-1', NOW).get('requestRevision')).toEqual({
      key: KEY_1,
      heldAt: NOW,
    });
  });

  // R1: without this the key named its trigger until the tab closed, and a
  // genuinely new act hours later was deduped against the old one by the server.
  it('drops an EXPIRED entry and erases it from storage', () => {
    put({ requestRevision: { key: KEY_1, heldAt: NOW - HELD_KEY_TTL_MS - 1 } });
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
    expect(store[NAME]).toBeUndefined();
    expect(ops).toContain(`remove ${NAME}`);
  });

  it('keeps a live entry beside an expired one, and rewrites only the survivor', () => {
    put({
      requestRevision: { key: KEY_1, heldAt: NOW - 60_000 },
      approveDesign: { key: KEY_2, heldAt: NOW - HELD_KEY_TTL_MS - 1 },
    });
    const keys = readHeldKeys('e-1', NOW);
    expect([...keys.keys()]).toEqual(['requestRevision']);
    expect(JSON.parse(store[NAME]!)).toEqual({
      requestRevision: { key: KEY_1, heldAt: NOW - 60_000 },
    });
  });

  it('leaves storage alone when every entry is live', () => {
    put({ requestRevision: { key: KEY_1, heldAt: NOW } });
    readHeldKeys('e-1', NOW);
    expect(ops).toEqual([`get ${NAME}`]);
  });

  it('discards a value that is not one of ours, including the old bare string', () => {
    // The first version of this mirror wrote `{"requestRevision":"<uuid>"}`. It
    // is refused rather than adopted with a guessed instant.
    put({ requestRevision: KEY_1 });
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
    put({ requestRevision: { key: { evil: 1 }, heldAt: NOW } });
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
    put({ requestRevision: { key: KEY_1, heldAt: 'soon' } });
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
    put({ requestRevision: { key: KEY_1 } });
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
  });

  // S1: this value is sent to a server action as the idempotency key, and
  // sessionStorage is writable by devtools or a post-XSS script. A non-uuid key
  // wedged that trigger for the life of the tab -- the core refuses it, the
  // refusal is not a DEFINITE one, so the poisoned entry was re-sent on every
  // retry and re-persisted.
  it('discards a key that is not UUID-SHAPED, and erases it', () => {
    put({ requestRevision: { key: 'not-a-uuid', heldAt: NOW } });
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
    expect(store[NAME]).toBeUndefined();

    put({ requestRevision: { key: `${KEY_1} `, heldAt: NOW } });
    expect(readHeldKeys('e-1', NOW).size).toBe(0);

    put({ requestRevision: { key: KEY_1.toUpperCase(), heldAt: NOW } });
    expect(readHeldKeys('e-1', NOW).get('requestRevision')?.key).toBe(KEY_1.toUpperCase());
  });

  it('survives junk in the slot without throwing', () => {
    store[NAME] = 'not json';
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
    store[NAME] = '["requestRevision"]';
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
    store[NAME] = '17';
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
  });

  it('does not let a stored __proto__ entry poison Object.prototype', () => {
    put({ __proto__: { key: KEY_1, heldAt: NOW } });
    readHeldKeys('e-1', NOW);
    expect(({} as Record<string, unknown>).key).toBeUndefined();
  });

  // Safari private mode throws on ACCESS, not just on write.
  it('answers an empty map when storage throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    });
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
    expect(() =>
      writeHeldKeys('e-1', held([['requestRevision', { key: KEY_1, heldAt: NOW }]])),
    ).not.toThrow();
  });

  it('answers an empty map where there is no storage at all', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(readHeldKeys('e-1', NOW).size).toBe(0);
  });
});
