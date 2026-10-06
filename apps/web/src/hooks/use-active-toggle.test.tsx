import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { useActiveToggle, type ActiveToggleCopy } from './use-active-toggle';

const undo = vi.hoisted(() => ({ onUndo: null as null | (() => void), title: '' }));
vi.mock('./undo-toast', () => ({
  showUndoToast: (options: { title: string; onUndo: () => void }) => {
    undo.onUndo = options.onUndo;
    undo.title = options.title;
  },
}));
const toasts = vi.hoisted(() => [] as { title?: string }[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: { title?: string }) => toasts.push(raised),
}));

afterEach(() => {
  cleanup();
  undo.onUndo = null;
  toasts.length = 0;
});

const COPY: ActiveToggleCopy = {
  confirmTitle: 'Deactivate?',
  confirmBody: 'It leaves the list.',
  confirmCta: 'Deactivate',
  cancel: 'Cancel',
  deactivated: 'Deactivated',
  activated: 'Activated',
  undo: 'Undo',
};

function Harness({
  setActive,
  onError,
  record,
}: {
  setActive: (id: string, active: boolean) => Promise<ActionResult>;
  onError: (result: ActionResult) => void;
  record: { id: string; active: boolean };
}) {
  const toggle = useActiveToggle({ setActive, copy: COPY, onError });
  return (
    <>
      <button type="button" onClick={() => void toggle.toggle(record)}>
        toggle
      </button>
      {toggle.dialog}
    </>
  );
}

function setup(record = { id: 'c-1', active: true }, result: ActionResult = { ok: true }) {
  const setActive = vi.fn(async (_id: string, _active: boolean) => result);
  const onError = vi.fn();
  render(<Harness setActive={setActive} onError={onError} record={record} />);
  fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
  return { setActive, onError };
}

describe('useActiveToggle (client, project, cost item, category)', () => {
  test('cancelling the confirm writes nothing', async () => {
    const { setActive } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(setActive).not.toHaveBeenCalled();
  });

  test('Escape on the confirm writes nothing', async () => {
    const { setActive } = setup();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(setActive).not.toHaveBeenCalled();
  });

  test('confirming deactivates once, then Undo re-activates exactly once', async () => {
    const { setActive } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(undo.onUndo).not.toBeNull());
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenLastCalledWith('c-1', false);
    expect(undo.title).toBe('Deactivated');

    await act(async () => undo.onUndo?.());
    await waitFor(() => expect(setActive).toHaveBeenCalledTimes(2));
    expect(setActive).toHaveBeenLastCalledWith('c-1', true);
    await waitFor(() => expect(toasts).toEqual([{ title: 'Activated' }]));
  });

  test('a refused deactivation reports it and offers no Undo', async () => {
    const refused: ActionResult = { ok: false, error: 'forbidden' };
    const { onError } = setup({ id: 'c-1', active: true }, refused);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(refused));
    expect(undo.onUndo).toBeNull();
  });

  test('activating an inactive record asks nothing', async () => {
    const { setActive } = setup({ id: 'c-1', active: false });
    await waitFor(() => expect(setActive).toHaveBeenCalledWith('c-1', true));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
