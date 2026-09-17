import { beforeEach, describe, expect, test, vi } from 'vitest';
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

/** Every key the hook was handed, in order, tagged with the trigger it named. */
const sent: { trigger: string; key: string }[] = [];

/** What the next dispatch of each trigger resolves to (or throws). */
const answers = new Map<string, ActionResult | 'throw'>();

function ActionProbe({ mintKey }: { mintKey: () => string }) {
  const { pending, error, runAction } = useEngagementAction({
    engagementId: 'e-1',
    mintKey,
  });
  const dispatch = (label: string, trigger?: Trigger) =>
    runAction(async (idempotencyKey) => {
      sent.push({ trigger: label, key: idempotencyKey });
      const answer = answers.get(label) ?? { ok: true };
      if (answer === 'throw') throw new Error('transport died');
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

function mountProbe() {
  let next = 0;
  const mintKey = () => `key-${++next}`;
  // Through the harness, not a bare RTL render: renderWithIntl is what registers
  // afterEach(cleanup), and two mounted probes would each answer getByRole.
  return renderWithIntl(<ActionProbe mintKey={mintKey} />);
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

beforeEach(() => {
  sent.length = 0;
  answers.clear();
  router.refresh.mockClear();
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
