import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { deriveFeeSplitPrefill } from '@/lib/engagements/default-fee-split';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { EngagementFeeForm } from './engagement-fee-form';

vi.mock('@/lib/engagements/actions', () => ({ submitDesignFee: vi.fn() }));

const en = (path: string) => messageAt('en', path);

function renderForm(prefill = deriveFeeSplitPrefill(null)) {
  renderWithIntl(
    <EngagementFeeForm
      engagementId="e-1"
      prefill={prefill}
      pending={false}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
    { locale: 'en' },
  );
}

const submit = () =>
  screen.getByRole('button', { name: en('engagements.feeForm.submit') }) as HTMLButtonElement;
const row = (kind: string) =>
  screen.getByLabelText(
    `${en(`engagements.milestoneKind.${kind}`)} ${en('engagements.feeForm.value')}`,
  ) as HTMLInputElement;
const typeFee = (value: string) =>
  fireEvent.change(screen.getByLabelText(en('engagements.feeForm.designFee')), {
    target: { value },
  });

describe('EngagementFeeForm', () => {
  test('opens on 50/30/20 with no history and waits for the fee', () => {
    renderForm();
    expect([row('deposit').value, row('gate_b').value, row('balance').value]).toEqual([
      '50',
      '30',
      '20',
    ]);
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(en('engagements.feeForm.needsFee'))).toBeTruthy();
    typeFee('90000');
    expect(submit().disabled).toBe(false);
  });

  test('stays disabled with an empty deposit or a total short of 100%', () => {
    renderForm();
    typeFee('90000');
    fireEvent.change(row('balance'), { target: { value: '10' } });
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(/90/)).toBeTruthy();
    fireEvent.change(row('balance'), { target: { value: '20' } });
    fireEvent.change(row('deposit'), { target: { value: '' } });
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(en('engagements.feeForm.needsDeposit'))).toBeTruthy();
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
