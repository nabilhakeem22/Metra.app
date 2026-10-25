import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { useConfirm } from './confirm-dialog';

// The shared imperative confirm (19 call sites): it answers true or false, and
// when it closes the keyboard focus goes back to the control that asked
// (S3 fix round, F4), never to the page.

afterEach(cleanup);

function Asker({ removeOnConfirm = false }: { removeOnConfirm?: boolean }) {
  const { confirm, dialog } = useConfirm();
  const [answer, setAnswer] = useState('none');
  const [shown, setShown] = useState(true);
  const ask = async () => {
    const confirmed = await confirm({ title: 'Remove him?', confirmLabel: 'Remove', cancelLabel: 'Cancel' });
    setAnswer(String(confirmed));
    if (confirmed && removeOnConfirm) setShown(false);
  };
  return (
    <div>
      {dialog}
      {shown && <button onClick={ask}>Ask</button>}
      <output>{answer}</output>
    </div>
  );
}

/** Let Radix finish closing (its focus hand-back runs after the close render). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openFrom(button: HTMLElement): Promise<void> {
  button.focus();
  await act(async () => {
    fireEvent.click(button);
  });
  expect(screen.getByRole('alertdialog')).toBeTruthy();
}

describe('useConfirm', () => {
  test('cancel answers false and gives the focus back to the control that asked', async () => {
    render(<Asker />);
    const ask = screen.getByRole('button', { name: 'Ask' });
    await openFrom(ask);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    await settle();
    expect(screen.getByRole('status').textContent).toBe('false');
    expect(document.activeElement).toBe(ask);
  });

  test('Escape answers false and gives the focus back too', async () => {
    render(<Asker />);
    const ask = screen.getByRole('button', { name: 'Ask' });
    await openFrom(ask);
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    });
    await settle();
    expect(screen.getByRole('status').textContent).toBe('false');
    expect(document.activeElement).toBe(ask);
  });

  test('confirm answers true and gives the focus back to the control that asked', async () => {
    render(<Asker />);
    const ask = screen.getByRole('button', { name: 'Ask' });
    await openFrom(ask);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    await settle();
    expect(screen.getByRole('status').textContent).toBe('true');
    expect(document.activeElement).toBe(ask);
  });

  test('a control gone by the time it closes is not focused (nothing to give back to)', async () => {
    render(<Asker removeOnConfirm />);
    await openFrom(screen.getByRole('button', { name: 'Ask' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    });
    await settle();
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull();
    expect(document.activeElement?.isConnected, 'the focus is not left on a removed control').toBe(true);
    expect(screen.getByRole('status').textContent).toBe('true');
  });
});
