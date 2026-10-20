import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { CONFIRM_CLAIM_FIELDS } from '@/lib/execution/claims/input';
import type { PendingClaimRow } from '@/lib/execution/claims/queries';
import { formatMoneyExact } from '@/lib/format/money';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ClaimsPanel } from './claims-panel';
import { confirmClaimControlId, ConfirmClaimDialog } from './confirm-claim-dialog';
import { DismissClaimDialog } from './dismiss-claim-dialog';

// PR B4.2: the client's "I paid" claims on the Payments tab. The panel lists
// each with its request, the amount and when it was sent, and offers confirm
// and "not received" only to the roles that record payments; the confirm
// dialog says every refusal under its one box (the forms-registry contract),
// a figure past what is due as money; the dismiss dialog says a refusal above
// its footer; every answer hands the tab its view or asks it to read itself.

const claims = vi.hoisted(() => ({ confirmContractClaim: vi.fn(), dismissContractClaim: vi.fn() }));
vi.mock('@/lib/execution/claims/actions', () => claims);

const CONTRACT = 'c0000000-0000-4000-8000-000000000001';
const CLAIM: PendingClaimRow = {
  id: 'k0000000-0000-4000-8000-000000000009',
  requestId: 'r0000000-0000-4000-8000-000000000004',
  requestNumber: 'PR-2026-0004',
  claimedAmount: '37000.5000',
  claimedAt: '2026-11-05T10:00:00.000Z',
};
const VIEW = { contractId: CONTRACT } as ContractBillingView;
const m = (value: string) => value;

beforeEach(() => {
  for (const action of Object.values(claims)) action.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('the claims on the Payments tab (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const show = (ui: React.ReactElement) => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    return renderWithIntl(ui, { locale });
  };
  const press = (name: string) => async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
    });
  };

  test('the panel lists a claim and offers its two answers to a role that records payments only', () => {
    const onConfirm = vi.fn();
    const first = show(<ClaimsPanel claims={[CLAIM]} canAnswer m={m} onConfirm={onConfirm} onDismiss={vi.fn()} />);
    expect(screen.getByText('PR-2026-0004')).toBeTruthy();
    expect(screen.getByText(at('contracts.execution.payments.claims.claimedOn').replace('{date}', '05/11/2026'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: at('contracts.execution.payments.claims.confirm.open') }));
    expect(onConfirm).toHaveBeenCalledWith(CLAIM);
    first.unmount();
    const second = show(<ClaimsPanel claims={[CLAIM]} canAnswer={false} m={m} onConfirm={onConfirm} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: at('contracts.execution.payments.claims.confirm.open') })).toBeNull();
    second.unmount();
    show(<ClaimsPanel claims={[]} canAnswer m={m} onConfirm={onConfirm} onDismiss={vi.fn()} />);
    expect(screen.queryByText('PR-2026-0004')).toBeNull();
  });

  test('confirm: the amount opens on the claim, its refusals sit under it, past what is due said as money', async () => {
    show(<ConfirmClaimDialog contractId={CONTRACT} claim={CLAIM} onAnswered={vi.fn()} onAlreadyConfirmed={vi.fn()} onClose={vi.fn()} />);
    expect((document.getElementById(confirmClaimControlId('amount')) as HTMLInputElement).value).toBe('37000.5');
    const submit = press(at('contracts.execution.payments.claims.confirm.submit'));
    await expectFieldErrorsRenderUnderFields({
      fields: CONFIRM_CLAIM_FIELDS,
      controlIdOf: confirmClaimControlId,
      answerWith: (result: ActionResult) => claims.confirmContractClaim.mockResolvedValue(result),
      submit,
      locale,
      typed: { [confirmClaimControlId('amount')]: '37000.5' },
    });
    claims.confirmContractClaim.mockResolvedValue({
      ok: false,
      error: 'check_fields',
      fields: { amount: { code: 'payment_exceeds_request', params: { outstanding: '36000.0000' } } },
    });
    await submit();
    const said = document.getElementById(`${confirmClaimControlId('amount')}-error`)?.textContent;
    expect(said).toBe(at('errors.payment_exceeds_request').replace('{outstanding}', formatMoneyExact('36000.0000', locale)));
  });

  test('confirm that worked hands the tab its view and closes; one already confirmed says so', async () => {
    const onAnswered = vi.fn();
    const onAlreadyConfirmed = vi.fn();
    const onClose = vi.fn();
    claims.confirmContractClaim.mockResolvedValue({ ok: true, data: 'p-1', already: true, view: VIEW });
    show(<ConfirmClaimDialog contractId={CONTRACT} claim={CLAIM} onAnswered={onAnswered} onAlreadyConfirmed={onAlreadyConfirmed} onClose={onClose} />);
    await press(at('contracts.execution.payments.claims.confirm.submit'))();
    expect(claims.confirmContractClaim).toHaveBeenCalledWith({ claimId: CLAIM.id, amount: '37000.5' }, { contractId: CONTRACT });
    expect(onAnswered).toHaveBeenCalledWith(VIEW);
    expect(onAlreadyConfirmed).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('dismiss: a refusal is said above the footer and the tab reads itself; one that worked closes', async () => {
    const onAnswered = vi.fn();
    const onClose = vi.fn();
    claims.dismissContractClaim.mockResolvedValueOnce({ ok: false, error: 'claim_not_found' });
    show(<DismissClaimDialog contractId={CONTRACT} claim={CLAIM} onAnswered={onAnswered} onClose={onClose} />);
    const submit = press(at('contracts.execution.payments.claims.dismiss.submit'));
    await submit();
    expect(onAnswered).toHaveBeenCalledWith(undefined);
    expect(screen.getByText(at('errors.claim_not_found'))).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    claims.dismissContractClaim.mockResolvedValueOnce({ ok: true, view: VIEW });
    await submit();
    expect(onAnswered).toHaveBeenLastCalledWith(VIEW);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
