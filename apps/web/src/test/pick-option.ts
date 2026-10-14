import { act, fireEvent, screen } from '@testing-library/react';

// TEST-ONLY. Choose one option of a Radix Select (SelectControl) the way a
// pointer does: Radix opens on a primary-button pointerdown, not on a click.
export async function pickOption(triggerId: string, optionName: string): Promise<void> {
  const trigger = document.getElementById(triggerId);
  if (!trigger) throw new Error(`pickOption: no #${triggerId}`);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await act(async () => {});
  fireEvent.click(screen.getByRole('option', { name: optionName }));
  // Radix hands focus back to the trigger on a timer after it closes; let it,
  // so a later focus assertion is not raced by it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
