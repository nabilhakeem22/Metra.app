import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { RetractButton } from './engagement-retract-button';

const actions = vi.hoisted(() => ({ recordEventCorrection: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/engagements/actions', () => actions);

afterEach(() => actions.recordEventCorrection.mockClear());

const en = (path: string) => messageAt('en', path);

function openWithReason() {
  const runAction = vi.fn((fn: () => Promise<unknown>) => void fn());
  renderWithIntl(
    <RetractButton engagementId="e-1" eventId="ev-1" pending={false} runAction={runAction} />,
    { locale: 'en' },
  );
  fireEvent.click(screen.getByRole('button', { name: en('engagements.timeline.retract') }));
  fireEvent.change(screen.getByLabelText(en('engagements.timeline.retractReason')), {
    target: { value: 'Logged on the wrong delivery' },
  });
  fireEvent.click(screen.getByRole('button', { name: en('engagements.timeline.retractConfirm') }));
}

describe('retracting a ledger row', () => {
  test('asks through ConfirmDialog; Cancel writes nothing', async () => {
    openWithReason();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en('common.cancel') }));
    await act(async () => {});
    expect(actions.recordEventCorrection).not.toHaveBeenCalled();
  });

  test('the dialog confirm is the destructive button, and it writes once with the reason', async () => {
    openWithReason();
    const dialog = await screen.findByRole('alertdialog');
    const confirmButton = within(dialog).getByRole('button', {
      name: en('engagements.timeline.retractConfirm'),
    });
    expect(confirmButton.className).toContain('var(--danger)');
    fireEvent.click(confirmButton);
    await act(async () => {});
    expect(actions.recordEventCorrection).toHaveBeenCalledTimes(1);
    expect(actions.recordEventCorrection).toHaveBeenCalledWith({
      engagementId: 'e-1',
      eventId: 'ev-1',
      reason: 'Logged on the wrong delivery',
    });
  });
});
