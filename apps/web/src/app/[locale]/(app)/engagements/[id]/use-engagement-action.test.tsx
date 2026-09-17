import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render-with-intl';
import type { ActionResult } from '@/lib/actions/result';
import type { Trigger } from '@/lib/engagements/transitions';
import { useEngagementAction } from './use-engagement-action';

// @/i18n/routing is spread from the REAL module: it also exports LOCALES, isRtl,
// dirFor and `routing`, and only the two hooks that need an App Router context
// are replaced.
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
  usePathname: () => '/ar-EG/engagements/e-1',
}));

const TRIGGERS: Trigger[] = ['requestRevision', 'approveDesign'];

/** Every key the hook was handed, in order, tagged with the trigger it named
 *  and the engagement it was dispatched for. */
const sent: { trigger: string; key: string; engagementId: string }[] = [];

/** What the next dispatch of each trigger resolves to (or throws, or waits for). */
const answers = new Map<string, ActionResult | 'throw' | 'defer'>();

/** The resolver of the one 'defer'red dispatch, so a test can land an answer
 *  AFTER the studio has navigated somewhere else. */
let landAnswer: ((result: ActionResult) => void) | null = null;

function ActionProbe({
  mintKey,
  engagementId = 'e-1',
  landedAt,
}: {
  mintKey: () => string;
  engagementId?: string;
  landedAt?: ReadonlyMap<string, number>;
}) {
  const { pending, error, runAction } = useEngagementAction({
    engagementId,
    landedAt,
    mintKey,
  });
  const dispatch = (label: string, trigger?: Trigger) =>
    runAction(async (idempotencyKey) => {
      sent.push({ trigger: label, key: idempotencyKey, engagementId });
      const answer = answers.get(label) ?? { ok: true };
      if (answer === 'throw') throw new Error('transport died');
      if (answer === 'defer') {
        return new Promise<ActionResult>((resolve) => {
          landAnswer = resolve;
        });
      }
      return answer;
    }, trigger);

  return (
    <div>
      {TRIGGERS.map((trigger) => (
        <button key={trigger} type="button" onClick={() => dispatch(trigger, trigger)}>
          {trigger}
        </button>
      ))}
      <button type="button" onClick={() => dispatch('recordPayment')}>
        recordPayment
      </button>
      <button
        type="button"
        onClick={() => {
          dispatch('requestRevision', 'requestRevision');
          dispatch('requestRevision', 'requestRevision');
        }}
      >
        doubleClick
      </button>
      <p data-testid="pending">{String(pending)}</p>
      <p data-testid="error">{error ?? 'none'}</p>
    </div>
  );
}

// MONOTONIC ACROSS MOUNTS, not per mount. A counter that restarted on every
// mount would hand the remount the same STRING as the first attempt whether or
// not the key had actually been carried over, which would make the A9 tests below
// pass for the wrong reason.
let minted = 0;

function mountProbe(landedAt?: ReadonlyMap<string, number>) {
  const mintKey = () => `key-${++minted}`;
  // Through the harness, not a bare RTL render: renderWithIntl is what registers
  // afterEach(cleanup), and two mounted probes would each answer getByRole.
  return renderWithIntl(<ActionProbe mintKey={mintKey} landedAt={landedAt} />);
}

/** Click a button and let the transition settle. */
async function press(label: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: label }));
  });
}

function keysFor(trigger: string): string[] {
  return sent.filter((entry) => entry.trigger === trigger).map((entry) => entry.key);
}

/**
 * The cockpit's own shape: the id changes WITHOUT a remount. `page.tsx` renders
 * <EngagementDetailClient> at a fixed position, so before the `key` landed a
 * soft navigation between two engagements re-rendered the same element type
 * there and React kept the subtree -- and everything it was holding -- alive.
 */
function SwitchingProbe({ mintKey }: { mintKey: () => string }) {
  const [engagementId, setEngagementId] = useState('e-1');
  return (
    <div>
      <button
        type="button"
        onClick={() => setEngagementId((current) => (current === 'e-1' ? 'e-2' : 'e-1'))}
      >
        switch
      </button>
      <ActionProbe mintKey={mintKey} engagementId={engagementId} />
    </div>
  );
}

function mountSwitchingProbe() {
  const mintKey = () => `key-${++minted}`;
  return renderWithIntl(<SwitchingProbe mintKey={mintKey} />);
}

beforeEach(() => {
  sent.length = 0;
  answers.clear();
  landAnswer = null;
  router.refresh.mockClear();
  // A9: held keys are now mirrored to sessionStorage, which outlives a single
  // mount by design. Without this, a key held by one test is read back by the
  // next one's fresh probe — which is exactly the behaviour under test, and
  // exactly why each test must start from an empty tab.
  sessionStorage.clear();
  minted = 0;
});

/**
 * Wave 2's F4: the per-trigger idempotency map. One shared key meant that any of
 * the fifteen actions on this screen released the key a half-finished
 * requestRevision was holding, and its retry minted a fresh one — a second ledger
 * row and a second allowance spent, from a success that had nothing to do with it.
 *
 * Wave 2 asserted it. Nothing has ever exercised it.
 */
describe('useEngagementAction — the held key', () => {
  test("an 'uncertain' attempt, retried, carries the SAME key", async () => {
    mountProbe();
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');
    await press('requestRevision');

    const keys = keysFor('requestRevision');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test('a THROWN attempt, retried, carries the SAME key', async () => {
    mountProbe();
    answers.set('requestRevision', 'throw');
    await press('requestRevision');
    await press('requestRevision');

    const keys = keysFor('requestRevision');
    expect(keys[0]).toBe(keys[1]);
  });

  test("a DEFINITE refusal ('forbidden') releases it — the retry is a new act", async () => {
    mountProbe();
    answers.set('requestRevision', { ok: false, error: 'forbidden' });
    await press('requestRevision');
    await press('requestRevision');

    const keys = keysFor('requestRevision');
    expect(keys[0]).not.toBe(keys[1]);
  });

  // THE DEFECT the per-trigger map exists to fix, and the one wave 2 could not
  // demonstrate: an unrelated success must not release another act's key.
  test('a recordPayment SUCCESS in between does not change the key requestRevision holds', async () => {
    mountProbe();
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');
    await press('recordPayment');
    await press('requestRevision');

    const keys = keysFor('requestRevision');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keysFor('recordPayment')[0]).not.toBe(keys[0]);
  });

  test('two DIFFERENT triggers hold two different keys at once', async () => {
    mountProbe();
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    answers.set('approveDesign', { ok: false, error: 'uncertain' });
    await press('requestRevision');
    await press('approveDesign');
    await press('requestRevision');
    await press('approveDesign');

    expect(keysFor('requestRevision')[0]).toBe(keysFor('requestRevision')[1]);
    expect(keysFor('approveDesign')[0]).toBe(keysFor('approveDesign')[1]);
    expect(keysFor('requestRevision')[0]).not.toBe(keysFor('approveDesign')[0]);
  });
});

describe('useEngagementAction — settling', () => {
  test('ok refreshes exactly once and leaves error null', async () => {
    mountProbe();
    await press('requestRevision');

    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('error').textContent).toBe('none');
  });

  test('a coded refusal sets that code and does NOT refresh', async () => {
    mountProbe();
    answers.set('requestRevision', { ok: false, error: 'rom_not_acknowledged' });
    await press('requestRevision');

    expect(screen.getByTestId('error').textContent).toBe('rom_not_acknowledged');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  // The stuck-spinner path. `pending` gates the command card, all five tab
  // headers and every panel form; an unguarded rejection would leave all of them
  // disabled with no way back but a reload.
  test("a rejection leaves pending false and sets error 'generic'", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountProbe();
    answers.set('requestRevision', 'throw');
    await press('requestRevision');

    expect(screen.getByTestId('pending').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toBe('generic');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('TWO CLICKS IN ONE FRAME dispatch once — the in-flight ref, not pending', async () => {
    mountProbe();
    await press('doubleClick');

    expect(keysFor('requestRevision')).toHaveLength(1);
  });
});

/**
 * A9 (wave-2, shipped here): the held keys are mirrored to sessionStorage, so an
 * attempt in doubt survives a remount. Wave 2 logged the gap as "one duplicate
 * revision / attestation" and wave 4 did not do it; this is the first wave that
 * can PROVE it.
 */
describe('useEngagementAction — the key survives a remount (A9)', () => {
  test('hold after uncertain, UNMOUNT, remount, retry — the SAME key', async () => {
    const first = mountProbe();
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');
    first.unmount();

    mountProbe();
    await press('requestRevision');

    const keys = keysFor('requestRevision');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test('a DEFINITE refusal clears the entry, so a remount starts fresh', async () => {
    const first = mountProbe();
    answers.set('requestRevision', { ok: false, error: 'forbidden' });
    await press('requestRevision');
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toBeNull();
    first.unmount();

    mountProbe();
    await press('requestRevision');
    const keys = keysFor('requestRevision');
    expect(keys[0]).not.toBe(keys[1]);
  });

  test('the entry is namespaced per engagement', async () => {
    mountProbe();
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toContain(
      keysFor('requestRevision')[0]!,
    );
    expect(sessionStorage.getItem('metra.pendingKeys.other')).toBeNull();
  });

  // Safari private mode throws on sessionStorage ACCESS, not just on write. A
  // cockpit that will not render because storage is unavailable is a far larger
  // defect than the one A9 closes.
  test('a sessionStorage that THROWS changes nothing else about the hook', async () => {
    const exploding = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    vi.stubGlobal('sessionStorage', exploding);
    try {
      mountProbe();
      answers.set('requestRevision', { ok: false, error: 'uncertain' });
      await press('requestRevision');
      await press('requestRevision');

      // Still held IN MEMORY for this mount: only surviving a remount is lost.
      const keys = keysFor('requestRevision');
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
      expect(screen.getByTestId('error').textContent).toBe('uncertain');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * Wave-5 remediation F1 = R4: the held-key map belongs to ONE ENGAGEMENT.
 *
 * A9 seeded it once per mount and mirrored it under whatever id was current, and
 * `page.tsx` rendered the cockpit with no `key` -- so a soft navigation from e-1
 * to e-2 sent e-2's write under e-1's idempotency key and overwrote the entry
 * e-1 was holding. Both halves are fixed: the page keys the subtree, and the map
 * is re-seeded whenever the engagement under it changes.
 */
describe('useEngagementAction — the map belongs to ONE engagement (F1/R4)', () => {
  test('e-1 keeps its key, e-2 mints its own, and the retry on e-1 reuses e-1s', async () => {
    mountSwitchingProbe();

    // 1. e-1 is left in doubt: it holds key-1.
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toContain('key-1');

    // 2. the id changes under the live subtree, and 3. e-2 succeeds.
    await press('switch');
    answers.set('requestRevision', { ok: true });
    await press('requestRevision');

    // e-1's entry is untouched by anything e-2 did.
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toContain('key-1');
    expect(sessionStorage.getItem('metra.pendingKeys.e-2')).toBeNull();

    // 4. back to e-1, and the in-doubt attempt is retried.
    await press('switch');
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');

    const dispatches = sent.filter((entry) => entry.trigger === 'requestRevision');
    expect(dispatches.map((entry) => entry.engagementId)).toEqual(['e-1', 'e-2', 'e-1']);
    expect(dispatches[0]!.key).toBe('key-1');
    // e-2's write carried its OWN key, not the one e-1 was holding.
    expect(dispatches[1]!.key).not.toBe(dispatches[0]!.key);
    // and the retry is recognised as the SAME act it was before the detour.
    expect(dispatches[2]!.key).toBe(dispatches[0]!.key);
  });

  test('an answer landing after the studio moved on settles the engagement it was sent for', async () => {
    mountSwitchingProbe();
    answers.set('requestRevision', 'defer');
    await press('requestRevision'); // e-1, still in flight
    await press('switch'); // now looking at e-2

    // A DEFINITE refusal: e-1's key is released -- on e-1.
    await act(async () => {
      landAnswer?.({ ok: false, error: 'forbidden' });
    });
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toBeNull();
    expect(sessionStorage.getItem('metra.pendingKeys.e-2')).toBeNull();

    // and e-2's next act is its own, not a key inherited from the detour.
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');
    const dispatches = sent.filter((entry) => entry.trigger === 'requestRevision');
    expect(dispatches[1]!.engagementId).toBe('e-2');
    expect(dispatches[1]!.key).not.toBe(dispatches[0]!.key);
    expect(sessionStorage.getItem('metra.pendingKeys.e-2')).toContain(dispatches[1]!.key);
  });
});

/**
 * Wave-5 remediation R1: a held key does not outlive the act it names.
 *
 * A9 gave it the life of the TAB with nothing bounding it, and the server reads
 * the key as proof of sameness — payments.ts returns the ORIGINAL row, the
 * executor's self-loop short-circuits to a bare `ok`. So a genuinely NEW act at
 * the same trigger later in the same tab was answered "done" and the write was
 * discarded. Two bounds: a fifteen-minute window, and the engagement's own
 * ledger saying the attempt landed after all.
 */
describe('useEngagementAction — a held key expires (R1)', () => {
  const START = Date.parse('2026-09-17T10:00:00.000Z');
  let clock: ReturnType<typeof vi.spyOn> | null = null;

  function setNow(at: number): void {
    clock ??= vi.spyOn(Date, 'now');
    clock.mockReturnValue(at);
  }

  afterEach(() => {
    clock?.mockRestore();
    clock = null;
  });

  test('a retry INSIDE the window is the same act', async () => {
    setNow(START);
    mountProbe();
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');

    setNow(START + 14 * 60_000);
    await press('requestRevision');

    const keys = keysFor('requestRevision');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test('the same click SIX HOURS later is a new act, in the same tab', async () => {
    setNow(START);
    mountProbe();
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');

    // The studio gave up, left the tab open, and came back to record something
    // genuinely different. Under A9 this carried the 10:00 key and the server
    // answered it with the 10:00 row.
    setNow(START + 6 * 60 * 60_000);
    await press('requestRevision');

    const keys = keysFor('requestRevision');
    expect(keys[0]).not.toBe(keys[1]);
    // and the new attempt is what is now being held, stamped with now.
    const stored = JSON.parse(sessionStorage.getItem('metra.pendingKeys.e-1')!) as Record<
      string,
      { key: string; heldAt: number }
    >;
    expect(stored.requestRevision!.key).toBe(keys[1]);
    expect(stored.requestRevision!.heldAt).toBe(START + 6 * 60 * 60_000);
  });

  test('an expired entry is ERASED from storage rather than replayed after a remount', async () => {
    setNow(START);
    const first = mountProbe();
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toContain('key-1');
    first.unmount();

    setNow(START + 16 * 60_000);
    mountProbe();
    await press('requestRevision');

    const keys = keysFor('requestRevision');
    expect(keys[0]).not.toBe(keys[1]);
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).not.toContain('key-1');
  });

  // The other bound: the page comes back showing that the attempt DID land.
  // "Refresh to check before trying again" is then answered, and the next click
  // is a decision the studio has taken with the record in front of them.
  test('a key whose act the LEDGER says landed is dropped, not re-used', async () => {
    setNow(START);
    sessionStorage.setItem(
      'metra.pendingKeys.e-1',
      JSON.stringify({ requestRevision: { key: 'old-key', heldAt: START - 60_000 } }),
    );
    mountProbe(new Map([['requestRevision', START - 30_000]]));
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');

    expect(keysFor('requestRevision')[0]).not.toBe('old-key');
  });

  test('a transition OLDER than the attempt says nothing, and the key is kept', async () => {
    setNow(START);
    sessionStorage.setItem(
      'metra.pendingKeys.e-1',
      JSON.stringify({ requestRevision: { key: 'old-key', heldAt: START - 60_000 } }),
    );
    mountProbe(new Map([['requestRevision', START - 90_000]]));
    answers.set('requestRevision', { ok: false, error: 'uncertain' });
    await press('requestRevision');

    expect(keysFor('requestRevision')[0]).toBe('old-key');
  });
});
