import { act, fireEvent, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ClientExpectedDate } from './client-expected-date';
import { CommandCardClaims } from './command-card-claims';
import { HandoffAckPanel } from './engagement-handoff-ack-panel';
import { PaymentForm } from './engagement-payment-form';
import { PaymentPanel } from './engagement-payment-panel';
import { EngagementRevisionForm } from './engagement-revision-form';
import { RomAckPanel } from './engagement-rom-ack-panel';
import { RomRangeForm } from './engagement-rom-range-form';
import { OfflineApprovalForm } from './offline-approval-form';
import type { RunAction } from './run-action';
import { useEngagementAction } from './use-engagement-action';

// AC 19 for the cockpit forms (W2.5): each field of a form's tuple, refused
// `required` by the server through the REAL runAction, is said under its own
// control, the caret goes to the first, and nothing is said in an alert.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const actions = vi.hoisted(() => ({
  logPaymentAndAdvance: vi.fn(),
  recordPayment: vi.fn(),
  recordRomAcknowledgement: vi.fn(),
  recordHandoffAcknowledgement: vi.fn(),
  setEngagementRom: vi.fn(),
  requestRevision: vi.fn(),
  designChangeRaised: vi.fn(),
  recordOfflineConceptApproval: vi.fn(),
  recordOfflineDesignApproval: vi.fn(),
  setClientExpectedDate: vi.fn(),
  confirmPaymentClaim: vi.fn(),
  dismissPaymentClaim: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => actions);

let minted = 0;
/** The form under the cockpit's real runAction, which is what hands it the answer. */
function WithRunAction({ children }: { children: (action: { pending: boolean; runAction: RunAction }) => ReactNode }) {
  const { pending, runAction } = useEngagementAction({
    engagementId: 'e-1',
    mintKey: () => `${String(++minted).padStart(8, '0')}-0000-4000-8000-000000000000`,
  });
  return <>{children({ pending, runAction })}</>;
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  sessionStorage.clear();
});

const type = (id: string, value: string) =>
  fireEvent.change(document.getElementById(id)!, { target: { value } });

describe.each<TestLocale>(['en', 'ar-EG'])('cockpit forms say refusals under their fields (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const press = (label: string) => async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at(label) }));
    });
  };
  const show = (ui: (action: { pending: boolean; runAction: RunAction }) => ReactNode) => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(<WithRunAction>{ui}</WithRunAction>, { locale });
  };
  const answer = (mock: ReturnType<typeof vi.fn>) => (result: ActionResult) => mock.mockResolvedValue(result);

  test('hero payment: amount, method, reference (the fold opens on a refusal)', async () => {
    show(({ pending, runAction }) => (
      <PaymentForm
        engagementId="e-1"
        paymentKind="deposit"
        defaultAmount="50000"
        mode="payAndAdvance"
        advanceTrigger="confirmAndPayDeposit"
        pending={pending}
        runAction={runAction}
        onDone={() => {}}
      />
    ));
    await expectFieldErrorsRenderUnderFields({
      fields: ['amount', 'method', 'reference'],
      controlIdOf: (field) => `hero-pay-${field}`,
      answerWith: answer(actions.logPaymentAndAdvance),
      submit: press('engagements.hero.logPaymentAdvance'),
      locale,
      typed: { 'hero-pay-amount': '50000' },
    });
  });

  test('payments panel: amount', async () => {
    show(({ pending, runAction }) => (
      <PaymentPanel engagementId="e-1" claimedMilestones={[]} pending={pending} runAction={runAction} onDone={() => {}} />
    ));
    type('pay-amount', '50000');
    await expectFieldErrorsRenderUnderFields({
      fields: ['amount'],
      controlIdOf: () => 'pay-amount',
      answerWith: answer(actions.recordPayment),
      submit: press('engagements.controls.save'),
      locale,
    });
  });

  test('ROM acknowledgement: day, evidence, note (the note fold opens on a refusal)', async () => {
    show(({ pending, runAction }) => (
      <RomAckPanel engagementId="e-1" pending={pending} runAction={runAction} onDone={() => {}} />
    ));
    await expectFieldErrorsRenderUnderFields({
      fields: ['occurredOn', 'evidence', 'note'],
      controlIdOf: (field) => `rom-ack-${field === 'occurredOn' ? 'occurred' : field}`,
      answerWith: answer(actions.recordRomAcknowledgement),
      submit: press('engagements.controls.save'),
      locale,
    });
  });

  test('handover acknowledgement: day, evidence, note', async () => {
    show(({ pending, runAction }) => (
      <HandoffAckPanel engagementId="e-1" pending={pending} runAction={runAction} onDone={() => {}} />
    ));
    await expectFieldErrorsRenderUnderFields({
      fields: ['occurredOn', 'evidence', 'note'],
      controlIdOf: (field) => `handoff-ack-${field === 'occurredOn' ? 'occurred' : field}`,
      answerWith: answer(actions.recordHandoffAcknowledgement),
      submit: press('engagements.handoffAck.submit'),
      locale,
    });
  });

  test('build-cost range: low and high', async () => {
    show(({ pending, runAction }) => (
      <RomRangeForm engagementId="e-1" pending={pending} runAction={runAction} onDone={() => {}} />
    ));
    type('rom-low', '100000');
    type('rom-high', '200000');
    await expectFieldErrorsRenderUnderFields({
      fields: ['romLow', 'romHigh'],
      controlIdOf: (field) => (field === 'romLow' ? 'rom-low' : 'rom-high'),
      answerWith: answer(actions.setEngagementRom),
      submit: press('engagements.controls.save'),
      locale,
      typed: { 'rom-low': '100000', 'rom-high': '200000' },
    });
  });

  test('revision past its allowance: the change-order amount', async () => {
    show(({ pending, runAction }) => (
      <EngagementRevisionForm
        engagementId="e-1"
        trigger="requestRevision"
        allowances={{ revisionCount: 2, freeRevisionN: 2, designRevisionCount: 0, freeDesignRevisionN: 1 }}
        pending={pending}
        runAction={runAction}
        onCancel={() => {}}
      />
    ));
    type('rev-amount', '5000');
    await expectFieldErrorsRenderUnderFields({
      fields: ['changeOrderAmount'],
      controlIdOf: () => 'rev-amount',
      answerWith: answer(actions.requestRevision),
      submit: press('engagements.revisionForm.submit'),
      locale,
    });
  });

  test('offline approval: channel, day, note', async () => {
    show(({ pending, runAction }) => (
      <OfflineApprovalForm
        engagementId="e-1"
        trigger="approveDesign"
        reviewRoundStartedAt={new Date(Date.now() - 86_400_000).toISOString()}
        conceptOptions={[]}
        pending={pending}
        runAction={runAction}
        onCancel={() => {}}
      />
    ));
    type('offline-approval-channel', 'phone');
    await expectFieldErrorsRenderUnderFields({
      fields: ['channel', 'occurredOn', 'note'],
      controlIdOf: (field) => ({ channel: 'offline-approval-channel', occurredOn: 'offline-approval-date', note: 'offline-approval-note' })[field],
      answerWith: answer(actions.recordOfflineDesignApproval),
      submit: press('engagements.offlineApproval.save'),
      locale,
    });
  });

  test('client expected date: the day', async () => {
    show(({ pending, runAction }) => (
      <ClientExpectedDate
        engagementId="e-1"
        card={{ view: { kind: 'none' }, min: '2026-01-01', max: '2099-01-01' }}
        pending={pending}
        runAction={runAction}
      />
    ));
    type('client-expected-on', new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
    await expectFieldErrorsRenderUnderFields({
      fields: ['expectedOn'],
      controlIdOf: () => 'client-expected-on',
      answerWith: answer(actions.setClientExpectedDate),
      submit: press('engagements.clientExpected.save'),
      locale,
    });
  });

  test('a payment claim: its own amount', async () => {
    show(({ pending, runAction }) => (
      <CommandCardClaims
        claims={[{ id: 'c-1', milestoneKind: 'deposit', claimedAmount: '30000.0000', note: null, actorName: null, createdAt: new Date() }]}
        preview={{ primaryTrigger: null, items: [], awaitingClientReview: false }}
        canAdvance={false}
        pending={pending}
        runAction={runAction}
      />
    ));
    await expectFieldErrorsRenderUnderFields({
      fields: ['amount'],
      controlIdOf: () => 'claim-amount-c-1',
      answerWith: answer(actions.confirmPaymentClaim),
      submit: press('engagements.paymentClaims.confirm'),
      locale,
      typed: { 'claim-amount-c-1': '30000' },
    });
  });

  test('a value the rules refuse is said before anything is sent or claims a key', async () => {
    show(({ pending, runAction }) => (
      <RomRangeForm engagementId="e-1" pending={pending} runAction={runAction} onDone={() => {}} />
    ));
    type('rom-low', '200000');
    type('rom-high', '100000');
    await press('engagements.controls.save')();
    expect(actions.setEngagementRom).not.toHaveBeenCalled();
    expect(document.getElementById('rom-high-error')?.textContent).toBe(at('errors.rom_range_invalid'));
    expect(document.getElementById('rom-low-error')).toBeNull();
    expect(document.activeElement?.id).toBe('rom-high');
  });
});
