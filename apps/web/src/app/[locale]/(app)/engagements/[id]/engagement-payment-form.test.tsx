import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { PaymentForm } from './engagement-payment-form';
import { useEngagementAction } from './use-engagement-action';

// @/i18n/routing is spread from the REAL module: only the two hooks that need an
// App Router context are replaced.
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
const actions = vi.hoisted(() => ({ logPaymentAndAdvance: vi.fn() }));
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

/** UUID-SHAPED, because the sessionStorage mirror refuses anything else (S1). */
const mintedKey = (count: number) => `0000000${count}-0000-4000-8000-000000000000`;
let minted = 0;

/**
 * The hero form as the command card mounts it, with the REAL `runAction` — which
 * is where the key it sends comes from. A form handed a stub would prove nothing:
 * the defect pinned here is that the form used to mint its own.
 */
function FormProbe() {
  const { pending, runAction } = useEngagementAction({
    engagementId: 'e-1',
    mintKey: () => mintedKey(++minted),
  });
  return (
    <PaymentForm
      engagementId="e-1"
      paymentKind="deposit"
      defaultAmount="50000"
      advanceTrigger="confirmAndPayDeposit"
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

function amountField(): HTMLInputElement {
  return screen.getByLabelText(ar('engagements.controls.amount')) as HTMLInputElement;
}

/** Open the optional detail disclosure (method + reference). */
function openDetails(): void {
  fireEvent.click(
    screen.getByRole('button', { name: `+ ${ar('engagements.controls.addDetails')}` }),
  );
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: ar('engagements.hero.logPaymentAdvance') }),
    );
  });
}

/** Type an amount over the prefill and submit — the ordinary path. */
async function record(amount: string): Promise<void> {
  fireEvent.change(amountField(), { target: { value: amount } });
  await submit();
}

/** Every (amount, method, reference, key) the server action was handed. */
function sent(): { amount: string; method: string | null; key: string }[] {
  return actions.logPaymentAndAdvance.mock.calls.map(([, input]) => ({
    amount: input.amount as string,
    method: input.method as string | null,
    key: input.idempotencyKey as string,
  }));
}

beforeEach(() => {
  actions.logPaymentAndAdvance.mockReset();
  actions.logPaymentAndAdvance.mockResolvedValue({ ok: true });
  router.refresh.mockClear();
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
 * Wave-5 remediation, loop 2 follow-up: the hero "Log payment & advance" is on
 * the same held-key discipline as the Payments tab panel (RT2) and the lifecycle
 * triggers. It used to mint one key per MOUNT, bounded only by the command
 * card's `key={paymentItem.amountDue}` remount — so an amount typed over the
 * prefill, a method or a reference changed in place all travelled on the key of
 * the attempt before them, and `logPaymentAndAdvanceCore` threads that key
 * straight into `recordPaymentCore` (ON CONFLICT DO NOTHING, ORIGINAL row, ok).
 */
describe('PaymentForm — one key per deliberate act', () => {
  test('two DIFFERENT payments through one open form carry two DIFFERENT keys', async () => {
    renderWithIntl(<FormProbe />);

    await record('50000');
    setNow(START + 6 * 60 * 60_000);
    await record('75000');

    const payments = sent();
    expect(payments.map((payment) => payment.amount)).toEqual(['50000', '75000']);
    expect(payments[0]!.key).not.toBe(payments[1]!.key);
  });

  // THE F1 REPRO (re-test `[B2]`), on the hero path — where the duplicate is
  // worse: `logPaymentAndAdvanceCore` records and THEN advances, in two steps, so
  // a duplicated payment persists even when the advance is refused afterwards.
  test('a definitely-refused TYPO between an attempt and its retry does not take its key', async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');
    const heldKey = sent()[0]!.key;

    setNow(START + 60_000);
    actions.logPaymentAndAdvance.mockResolvedValue({
      ok: false,
      error: 'payment_amount_invalid',
    });
    await record('5o,ooo');

    setNow(START + 120_000);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');

    const payments = sent();
    expect(payments.map((payment) => payment.amount)).toEqual(['50000', '5o,ooo', '50000']);
    expect(payments[1]!.key).not.toBe(heldKey);
    expect(payments[2]!.key).toBe(heldKey);
  });

  test("an 'uncertain' answer, retried with the SAME input, carries the SAME key", async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: false, error: 'uncertain' });

    await record('50000');
    setNow(START + 14 * 60_000);
    await submit();

    const payments = sent();
    expect(payments).toHaveLength(2);
    expect(payments[0]!.key).toBe(payments[1]!.key);
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toContain(payments[0]!.key);
  });

  test("after an 'uncertain', a CHANGED AMOUNT is a new act with a new key", async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: false, error: 'uncertain' });

    await record('50000');
    await record('30000');

    const payments = sent();
    expect(payments.map((payment) => payment.amount)).toEqual(['50000', '30000']);
    expect(payments[0]!.key).not.toBe(payments[1]!.key);
  });

  // The act is EVERY submitted field, not just the amount: a studio who adds the
  // bank reference after a refusal is recording the same payment, described
  // differently — and the server would answer the described-differently one with
  // the first row, silently dropping the detail they came back to add.
  test("after an 'uncertain', a CHANGED REFERENCE is a new act with a new key", async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: false, error: 'uncertain' });

    await record('50000');
    openDetails();
    fireEvent.change(screen.getByLabelText(ar('engagements.controls.reference')), {
      target: { value: 'TRX-9911' },
    });
    await submit();

    const payments = sent();
    expect(payments[0]!.key).not.toBe(payments[1]!.key);
  });

  // F3: the two references differ only at character 41, and the server accepts
  // 200. While the act truncated each value at 40, this was ONE act and the
  // second wire was answered with the first one's row.
  test('two wire references differing past character 40 are two acts', async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: false, error: 'uncertain' });
    const reference = (sequence: string) =>
      `EGY-NBE-WIRE-2026-09-17-BRANCH-014-SEQ-${sequence}`;

    openDetails();
    const field = screen.getByLabelText(ar('engagements.controls.reference'));
    fireEvent.change(field, { target: { value: reference('0001') } });
    await record('50000');

    setNow(START + 3 * 60_000);
    fireEvent.change(field, { target: { value: reference('0002') } });
    await submit();

    const payments = sent();
    expect(payments[0]!.key).not.toBe(payments[1]!.key);
  });

  test("after an 'uncertain', a CHANGED METHOD is a new act with a new key", async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: false, error: 'uncertain' });

    await record('50000');
    openDetails();
    fireEvent.change(screen.getByLabelText(ar('engagements.controls.method')), {
      target: { value: 'تحويل بنكي' },
    });
    await submit();

    const payments = sent();
    expect(payments.map((payment) => payment.method)).toEqual([null, 'تحويل بنكي']);
    expect(payments[0]!.key).not.toBe(payments[1]!.key);
  });

  test('a DEFINITE refusal releases the key, so the next submit is a new act', async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({
      ok: false,
      error: 'payment_kind_mismatch',
    });

    await record('50000');
    expect(sessionStorage.getItem('metra.pendingKeys.e-1')).toBeNull();
    await submit();

    expect(sent()[0]!.key).not.toBe(sent()[1]!.key);
  });

  test('the in-doubt key survives the REMOUNT the command card does', async () => {
    // key={paymentItem.amountDue} remounts this form when a short payment
    // revalidates the due down. That used to be the only bound on the key; the
    // retry of an attempt in doubt must now survive it.
    const first = renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');
    first.unmount();

    renderWithIntl(<FormProbe />);
    await record('50000');

    expect(sent()[0]!.key).toBe(sent()[1]!.key);
  });

  test('the hero form and the Payments panel do not share an entry', async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: false, error: 'uncertain' });
    await record('50000');

    const stored = JSON.parse(sessionStorage.getItem('metra.pendingKeys.e-1')!) as Record<
      string,
      unknown
    >;
    // ONE entry, filed under this control AND this act (F1) — never under the
    // bare control name, which the panel would then share.
    const slots = Object.keys(stored);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.startsWith('logPaymentAndAdvance|')).toBe(true);
    expect(slots[0]).not.toBe('logPaymentAndAdvance');
  });
});

/**
 * Backlog 18. `recordPaymentCore` has answered a repeated idempotency key with
 * `{ ok: true, already: true }` since 0050 - the ledger was NOT appended and the
 * original row was handed back - and for five waves no screen looked.
 * `logPaymentAndAdvanceCore` used to drop the flag on the floor as well: it
 * returned `{ ...advanced, paymentRecorded }`, so the combined control could not
 * have read it even if it had tried.
 */
describe('PaymentForm — a replayed payment is SAID, not silently reported as saved', () => {
  test('an `already` success raises its own message instead of a plain one', async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: true, already: true });

    await record('50000');

    expect(toasts).toEqual([
      {
        title: ar('engagements.controls.alreadyRecorded'),
        description: ar('engagements.controls.alreadyRecordedHint'),
      },
    ]);
    // Still a success: the form closes and the page refreshes, because a row for
    // this act DOES exist. What changed is that the studio is told which one.
    expect(router.refresh).toHaveBeenCalled();
  });

  test('an ordinary success says nothing extra', async () => {
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({ ok: true });

    await record('50000');

    expect(toasts).toEqual([]);
  });

  test('a REFUSAL carrying `already` says nothing — the flag is only read on ok', async () => {
    // `already` rides out beside a blocked advance (the payment replayed, the
    // guard still refused). Announcing "already recorded" over a refusal would
    // tell the studio the opposite of what happened.
    renderWithIntl(<FormProbe />);
    actions.logPaymentAndAdvance.mockResolvedValue({
      ok: false,
      error: 'gate_a_not_cleared',
      already: true,
    });

    await record('50000');

    expect(toasts).toEqual([]);
  });
});
