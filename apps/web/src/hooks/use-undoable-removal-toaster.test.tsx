import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Toaster } from '@/components/ui/toaster';
import type { ActionResult } from '@/lib/actions/result';
import { UNDO_HARD_CAP_MS } from './undo-toast';
import { useToast } from './use-toast';
import { useUndoableRemoval } from './use-undoable-removal';

// Ported from the A2 testers' repros (t1a2/undo-pause, a2-rel/undo-race): the
// REAL Toaster and Radix toast, only the server delete is a double. Before the
// single-clock fix each of these showed an Undo that no longer worked.

let toastApi: ReturnType<typeof useToast> | null = null;
function ToastApi() {
  toastApi = useToast();
  return null;
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  act(() => toastApi?.dismiss());
  await act(async () => vi.advanceTimersByTime(6000));
  cleanup();
  vi.useRealTimers();
});

function Rows({ commit }: { commit: (id: string) => Promise<ActionResult> }) {
  const removal = useUndoableRemoval({
    commit,
    messages: { removed: 'Removed', undo: 'Undo' },
    onFailed: () => {},
  });
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'].filter((id) => !removal.hiddenIds.has(id));
  return (
    <ul>
      {ids.map((id) => (
        <li key={id}>
          row-{id}
          <button type="button" onClick={() => removal.remove(id)}>
            del-{id}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Harness({ commit }: { commit: (id: string) => Promise<ActionResult> }) {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      {mounted && <Rows commit={commit} />}
      <button type="button" onClick={() => setMounted(false)}>
        leave
      </button>
      <Toaster />
      <ToastApi />
    </>
  );
}

const undoButtons = () => screen.queryAllByRole('button', { name: 'Undo' });
const region = () => document.querySelector('ol')!.parentElement!;

function setup() {
  const commit = vi.fn(async (_id: string): Promise<ActionResult> => ({ ok: true }));
  render(<Harness commit={commit} />);
  return commit;
}

describe('the Undo toast and the delete share one clock', () => {
  test('untouched: the toast closes at 5 s and only then is the delete sent', async () => {
    const commit = setup();
    fireEvent.click(screen.getByText('del-a'));
    await act(async () => vi.advanceTimersByTime(4900));
    expect(commit).not.toHaveBeenCalled();
    expect(undoButtons()).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(200));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undoButtons()).toHaveLength(0);
  });

  test('hovering the toast holds the delete; a late Undo still restores the row', async () => {
    const commit = setup();
    fireEvent.click(screen.getByText('del-a'));
    await act(async () => vi.advanceTimersByTime(4500));
    fireEvent.pointerMove(region());
    await act(async () => vi.advanceTimersByTime(2000));
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(undoButtons()[0]!);
    await act(async () => vi.advanceTimersByTime(6000));
    expect(commit).not.toHaveBeenCalled();
    expect(screen.queryByText('row-a')).not.toBeNull();
  });

  test('a blurred window holds the delete with its toast until the hard cap, then commits once', async () => {
    const commit = setup();
    fireEvent.click(screen.getByText('del-b'));
    await act(async () => vi.advanceTimersByTime(1000));
    fireEvent.blur(window);
    await act(async () => vi.advanceTimersByTime(UNDO_HARD_CAP_MS - 1000 - 1));
    expect(commit).not.toHaveBeenCalled();
    expect(undoButtons()).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undoButtons()).toHaveLength(0);
  });

  test('leaving the screen commits and takes the Undo toast with it', async () => {
    const commit = setup();
    fireEvent.click(screen.getByText('del-c'));
    await act(async () => vi.advanceTimersByTime(1000));
    fireEvent.click(screen.getByText('leave'));
    await act(async () => vi.advanceTimersByTime(10));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undoButtons()).toHaveLength(0);
  });

  test('five quick deletes: the Undo toast evicted by the limit commits at eviction', async () => {
    const commit = setup();
    for (const id of ['a', 'b', 'c', 'd', 'e']) fireEvent.click(screen.getByText(`del-${id}`));
    await act(async () => vi.advanceTimersByTime(10));
    expect(undoButtons()).toHaveLength(4);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('a');
  });

  test('a slow server: once the delete is sent there is no Undo left to press', async () => {
    let answer!: (result: ActionResult) => void;
    const commit = vi.fn(() => new Promise<ActionResult>((resolve) => (answer = resolve)));
    render(<Harness commit={commit} />);
    fireEvent.click(screen.getByText('del-d'));
    await act(async () => vi.advanceTimersByTime(5100));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undoButtons()).toHaveLength(0);
    answer({ ok: true });
    await act(async () => vi.advanceTimersByTime(10));
    expect(screen.queryByText('row-d')).toBeNull();
  });
});
