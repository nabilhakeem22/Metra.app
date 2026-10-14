import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { deriveFeeSplitPrefill } from '@/lib/engagements/default-fee-split';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { EngagementFeeForm } from './engagement-fee-form';

vi.mock('@/lib/engagements/actions', () => ({ submitDesignFee: vi.fn() }));

const en = (path: string) => messageAt('en', path);

const onSubmit = vi.fn();

function renderForm(prefill = deriveFeeSplitPrefill(null)) {
  onSubmit.mockReset();
  renderWithIntl(
    <EngagementFeeForm
      engagementId="e-1"
      prefill={prefill}
      pending={false}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
    { locale: 'en' },
  );
}

async function press() {
  await act(async () => {
    fireEvent.click(submit());
  });
}

const submit = () =>
  screen.getByRole('button', { name: en('engagements.feeForm.submit') }) as HTMLButtonElement;
const row = (kind: string) =>
  screen.getByLabelText(
    `${en(`engagements.milestoneKind.${kind}`)} ${en('engagements.feeForm.value')}`,
  ) as HTMLInputElement;
const typeFee = (value: string) =>
  fireEvent.change(document.getElementById('fee-amount')!, { target: { value } });
const under = (id: string) => document.getElementById(`${id}-error`)?.textContent;

describe('EngagementFeeForm', () => {
  test('opens on 50/30/20 with no history; Submit with no fee says so under the fee', async () => {
    renderForm();
    expect([row('deposit').value, row('gate_b').value, row('balance').value]).toEqual([
      '50',
      '30',
      '20',
    ]);
    expect(submit().disabled).toBe(false);
    expect(screen.getByText(en('engagements.feeForm.needsFee'))).toBeTruthy();
    await press();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(under('fee-amount')).toBe(en('errors.design_fee_required'));
    expect(document.activeElement?.id).toBe('fee-amount');
    typeFee('90000');
    expect(under('fee-amount')).toBeUndefined();
    await press();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('an empty deposit or a total short of 100% is said under the split', async () => {
    renderForm();
    typeFee('90000');
    fireEvent.change(row('balance'), { target: { value: '10' } });
    expect(screen.getByText(/90/)).toBeTruthy();
    await press();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(under('fee-milestones')).toBe(en('errors.milestone_split_invalid'));
    expect(row('deposit').getAttribute('aria-describedby')).toBe('fee-milestones-error');
    fireEvent.change(row('balance'), { target: { value: '20' } });
    expect(under('fee-milestones')).toBeUndefined();
    fireEvent.change(row('deposit'), { target: { value: '' } });
    expect(screen.getByText(en('engagements.feeForm.needsDeposit'))).toBeTruthy();
    await press();
    expect(under('fee-milestones')).toBe(en('errors.milestone_split_invalid'));
  });

  test('says when the split came from the last schedule', () => {
    renderForm(
      deriveFeeSplitPrefill({
        designFee: null,
        milestones: [
          { kind: 'deposit', basis: 'percent', value: '40.0000' },
          { kind: 'gate_b', basis: 'percent', value: '40.0000' },
          { kind: 'balance', basis: 'percent', value: '20.0000' },
        ],
      }),
    );
    expect(screen.getByText(en('engagements.feeForm.prefilledFromLast'))).toBeTruthy();
    expect(row('deposit').value).toBe('40');
  });
});
