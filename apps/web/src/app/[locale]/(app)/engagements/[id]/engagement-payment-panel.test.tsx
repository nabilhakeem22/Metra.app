import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { PaymentPanel } from './engagement-payment-panel';
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

// @/lib/engagements/actions is 'use server' — it reaches requireOrg and the whole
// server-only stack, which the unit config deliberately does not stub.
const actions = vi.hoisted(() => ({ recordPayment: vi.fn() }));
vi.mock('@/lib/engagements/actions', () => actions);

// The toast store is module-level, so a spy on `toast` is the whole surface.
interface RaisedToast {
  title?: string;
  description?: string;
}
const toasts = vi.hoisted(() => [] as RaisedToast[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: RaisedToast) => {
    toasts.push(raised);
  },
}));

const ar = (path: string) => messageAt('ar-EG', path);

/** UUID-SHAPED, because the sessionStorage mirror refuses anything else (S1) —
 *  and still readable: the mint counter is the last digit of the first group. */
const mintedKey = (count: number) => `0000000${count}-0000-4000-8000-000000000000`;
let minted = 0;

/**
 * The panel as the cockpit mounts it: its `runAction` is the REAL hook, which is
 * where the key it sends comes from. A panel handed a stub would prove nothing —
 * the defect being pinned here is precisely that the panel used to mint its own.
 */
function PanelProbe({ landedKeys }: { landedKeys?: ReadonlySet<string> }) {
  const { pending, runAction } = useEngagementAction({
    engagementId: 'e-1',
    landedKeys,
    mintKey: () => mintedKey(++minted),
  });
  return (
    <PaymentPanel
      engagementId="e-1"
      pending={pending}
      runAction={runAction}
      onDone={() => {}}
    />
  );
}

const START = Date.parse('2026-09-17T10:00:00.000Z');
let clock: ReturnType<typeof vi.spyOn> | null = null;

function setNow(at: number): void {
  clock ??= vi.spyOn(Date, 'now');
  clock.mockReturnValue(at);
}

/** Type an amount into the open panel and submit it. */
async function record(amount: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(ar('engagements.controls.amount')), {
    target: { value: amount },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: ar('engagements.controls.save') }));
  });
}

/** Every (amount, key) pair the server action was handed, in order. */
function sent(): { amount: string; key: string }[] {
  return actions.recordPayment.mock.calls.map(([input]) => ({
    amount: input.amount as string,
    key: input.idempotencyKey as string,
  }));
}

beforeEach(() => {
  actions.recordPayment.mockReset();
  actions.recordPayment.mockResolvedValue({ ok: true });
  router.refresh.mockClear();
  // The held keys are mirrored to sessionStorage, which outlives one mount by
  // design — so each test must start from an empty tab.
  sessionStorage.clear();
  toasts.length = 0;
  minted = 0;
  setNow(START);
});

afterEach(() => {
  clock?.mockRestore();
  clock = null;
});

/**
 * Wave-5 remediation RT2: the payment path is on the SAME held-key discipline as
 * the lifecycle triggers.
 *
 * `engagement-payment-panel.tsx` used to mint ONE key per MOUNT and call
 * `runAction` with no trigger, so nothing about it was bounded: two genuinely
 * different payments logged in one open panel went out on ONE key, and
 * `payments.ts` (ON CONFLICT DO NOTHING, returning the ORIGINAL row with `ok`)
 * discarded the second while the panel closed as though it had saved.
 */
describe('PaymentPanel — one key per deliberate act', () => {
  test('two DIFFERENT payments in one open panel carry two DIFFERENT keys', async () => {
    renderWithIntl(<PanelProbe />);

    await record('50000');
    // Six hours later, in the same open panel, a genuinely different payment.
    setNow(START + 6 * 60 * 60_000);
    await record('75000');

    const payments = sent();
    expect(payments.map((payment) => payment.amount)).toEqual(['50000', '75000']);
    expect(payments[0]!.key).not.toBe(payments[1]!.key);
  });

  test('a second payment right after a successful one is still its own act', async () => {
    renderWithIntl(<PanelProbe />);

    await record('50000');
    await record('75000');

    expect(sent()[0]!.key).not.toBe(sent()[1]!.key);
    // Success released the key: nothing is being held for the panel.
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toBeNull();
  });

  // THE F1 REPRO (re-test `[B2b]`). The map used to hold ONE ENTRY PER CONTROL,
  // so the typo's entry evicted the in-doubt one and its definite refusal then
  // released the slot outright — and the retry of the FIRST act, two minutes into
  // a fifteen-minute window, went out under a fresh identity. If the first
  // attempt had committed, that is a second EGP 50,000 row in an append-only
  // ledger, reported as saved.
  test('a definitely-refused TYPO between an attempt and its retry does not take its key', async () => {
    renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');
    const heldKey = sent()[0]!.key;

    setNow(START + 60_000);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'payment_amount_invalid' });
    await record('50,000');

    setNow(START + 120_000);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');

    const payments = sent();
    expect(payments.map((payment) => payment.amount)).toEqual(['50000', '50,000', '50000']);
    expect(payments[1]!.key).not.toBe(heldKey);
    expect(payments[2]!.key).toBe(heldKey);
  });

  test('a SUCCESSFUL different payment does not release the in-doubt one either', async () => {
    renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');
    const heldKey = sent()[0]!.key;

    setNow(START + 60_000);
    actions.recordPayment.mockResolvedValue({ ok: true });
    await record('75000');

    setNow(START + 120_000);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');

    expect(sent()[2]!.key).toBe(heldKey);
  });

  test("an 'uncertain' answer, retried with the SAME amount, carries the SAME key", async () => {
    renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });

    await record('50000');
    // The studio refreshed, could not tell, and clicked again fourteen minutes
    // later. This is the retry the whole mechanism exists for.
    setNow(START + 14 * 60_000);
    await record('50000');

    const payments = sent();
    expect(payments).toHaveLength(2);
    expect(payments[0]!.key).toBe(payments[1]!.key);
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toContain(payments[0]!.key);
  });

  test("after an 'uncertain', a DIFFERENT amount is a NEW act with a NEW key", async () => {
    renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });

    await record('50000');
    await record('75000');

    const payments = sent();
    expect(payments.map((payment) => payment.amount)).toEqual(['50000', '75000']);
    expect(payments[0]!.key).not.toBe(payments[1]!.key);
  });

  test('the same amount SIX HOURS later is a new act — the key is not held forever', async () => {
    renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });

    await record('50000');
    setNow(START + 6 * 60 * 60_000);
    await record('50000');

    expect(sent()[0]!.key).not.toBe(sent()[1]!.key);
  });

  test('a DEFINITE refusal releases the key, so the next click is a new act', async () => {
    renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({
      ok: false,
      error: 'payment_amount_invalid',
    });

    await record('50000');
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toBeNull();
    await record('50000');

    expect(sent()[0]!.key).not.toBe(sent()[1]!.key);
  });

  /**
   * F2: a payment writes no transition row, so until the PAYMENT ledger was
   * folded into `landedKeys` nothing could ever tell the cockpit that a payment
   * in doubt had landed. A studio who did exactly what the `uncertain` copy says
   * — refresh, look, and only then decide — had their next, genuinely new
   * payment of the same figure answered with the first one's row and reported as
   * saved.
   */
  test('a payment the LEDGER now carries is dropped, so the next identical one is a new act', async () => {
    const first = renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');
    const heldKey = sent()[0]!.key;
    first.unmount();

    // The studio refreshes. The page comes back with the payment ledger CARRYING
    // that key: the attempt committed after all.
    setNow(START + 5 * 60_000);
    renderWithIntl(<PanelProbe landedKeys={new Set([heldKey])} />);
    actions.recordPayment.mockResolvedValue({ ok: true });
    await record('50000');

    expect(sent()[1]!.key).not.toBe(heldKey);
  });

  test('a ledger carrying OTHER payments still holds the key in doubt', async () => {
    const first = renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');
    const heldKey = sent()[0]!.key;
    first.unmount();

    setNow(START + 5 * 60_000);
    renderWithIntl(<PanelProbe landedKeys={new Set(['somebody-elses-key'])} />);
    await record('50000');

    expect(sent()[1]!.key).toBe(heldKey);
  });

  test('the held key survives a REMOUNT of the panel, as the triggers do', async () => {
    const first = renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');
    first.unmount();

    renderWithIntl(<PanelProbe />);
    await record('50000');

    expect(sent()[0]!.key).toBe(sent()[1]!.key);
  });
});

/**
 * Backlog 18, and the cheapest fix in the whole programme: `recordPaymentCore`
 * has answered a repeated idempotency key with `{ ok: true, already: true }`
 * since 0050 - the ledger was NOT appended, the ORIGINAL row came back - and
 * this panel closed on it exactly as it closes on a fresh write. Three testers
 * traced duplicate-payment defects across two waves and every one of them ended
 * here: the server already knew, and no screen looked.
 */
describe('PaymentPanel — a replayed payment is SAID, not silently reported as saved', () => {
  test('an `already` success raises its own message instead of a plain one', async () => {
    renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: true, already: true });

    await record('50000');

    expect(toasts).toEqual([
      {
        title: ar('engagements.controls.alreadyRecorded'),
        description: ar('engagements.controls.alreadyRecordedHint'),
      },
    ]);
    // Still a success: a row for this act exists, so the panel closes and the
    // page refreshes. What changed is that the studio is told WHICH row.
    expect(router.refresh).toHaveBeenCalled();
  });

  test('an ordinary success says nothing extra', async () => {
    renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: true });

    await record('50000');

    expect(toasts).toEqual([]);
  });

  test('the retry of an in-doubt attempt is where this actually fires', async () => {
    // The held-key path end to end: an `uncertain` first answer holds the key,
    // the studio retries the SAME figures, the server recognises the key and
    // answers `already`. Before this change that retry looked like a clean save,
    // which is the one reading that could make a studio record it a third time.
    renderWithIntl(<PanelProbe />);
    actions.recordPayment.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');
    expect(toasts).toEqual([]);

    setNow(START + 60_000);
    actions.recordPayment.mockResolvedValue({ ok: true, already: true });
    await record('50000');

    const payments = sent();
    expect(payments[0]!.key).toBe(payments[1]!.key);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.title).toBe(ar('engagements.controls.alreadyRecorded'));
  });
});
