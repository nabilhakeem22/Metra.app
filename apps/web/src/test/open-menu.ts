import { fireEvent, screen } from '@testing-library/react';

// TEST-ONLY. Radix opens a dropdown on a primary-button pointerdown, not on a
// click, so a test that wants the OverflowMenu's items opens it this way.
export function openMenu(name: string): void {
  const trigger = screen.getByRole('button', { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}
