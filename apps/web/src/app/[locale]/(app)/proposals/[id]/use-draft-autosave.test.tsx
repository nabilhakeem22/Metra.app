import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ProposalDraftState } from './proposal-payload';
import { useDraftAutosave } from './use-draft-autosave';

const saves = vi.hoisted(() => ({ autosaveDraft: vi.fn(), persistDraft: vi.fn() }));
vi.mock('./persist-draft', () => saves);

function draftWith(qty: string): ProposalDraftState {
  return {
    id: 'p-1',
    discountPct: '0',
    taxRate: '0',
    supervisionPct: '0',
    seeMargin: true,
    sections: [
      {
        titleEn: 'Ceilings',
        titleAr: '',
        lines: [
          {
            id: 'l-1',
            costItemId: null,
            descriptionEn: 'Gypsum',
            descriptionAr: '',
            qty,
            unit: 'sqm',
            unitCost: '60',
            unitPrice: '100',
            discountPct: '0',
          },
        ],
      },
    ],
  };
}

/** A save the test answers by hand. */
function heldSave() {
  let answer: (result: { ok: boolean; error?: string }) => void = () => {};
  saves.autosaveDraft.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  return (result: { ok: boolean; error?: string }) => act(async () => answer(result));
}

function renderAutosave() {
  return renderHook(({ draft }) => useDraftAutosave({ draft, enabled: true }), {
    initialProps: { draft: draftWith('1') },
  });
}

const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  saves.autosaveDraft.mockResolvedValue({ ok: true });
  saves.persistDraft.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  // Unmounting stores an unsaved edit; let that settle before the mocks reset.
  cleanup();
  await act(async () => {});
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useDraftAutosave', () => {
  it('3 edits within 1 s save once, 1500 ms after the last', async () => {
    const hook = renderAutosave();
    expect(hook.result.current.saveState).toBe('saved');
    hook.rerender({ draft: draftWith('2') });
    await advance(400);
    hook.rerender({ draft: draftWith('3') });
    await advance(400);
    hook.rerender({ draft: draftWith('4') });
    expect(hook.result.current.saveState).toBe('dirty');
    await advance(1499);
    expect(saves.autosaveDraft).not.toHaveBeenCalled();
    await advance(1);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
    expect(saves.autosaveDraft.mock.calls[0][0].sections[0].lines[0].qty).toBe('4');
    expect(hook.result.current.saveState).toBe('saved');
    expect(hook.result.current.lastSavedAt).toBeInstanceOf(Date);
    expect(saves.persistDraft).not.toHaveBeenCalled();
  });

  it('an edit during a save queues exactly one more, never two at once', async () => {
    const answerFirst = heldSave();
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    expect(hook.result.current.saveState).toBe('saving');
    hook.rerender({ draft: draftWith('3') });
    await advance(1500);
    hook.rerender({ draft: draftWith('4') });
    await advance(1500);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
    await answerFirst({ ok: true });
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(2);
    expect(saves.autosaveDraft.mock.calls[1][0].sections[0].lines[0].qty).toBe('4');
    await advance(5000);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(2);
    expect(hook.result.current.saveState).toBe('saved');
  });

  it('a failure stops at failed with its code, and nothing retries until retry()', async () => {
    saves.autosaveDraft.mockResolvedValueOnce({ ok: false, error: 'line_required' });
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    expect(hook.result.current.saveState).toBe('failed');
    expect(hook.result.current.error).toBe('line_required');
    await advance(60_000);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
    await act(async () => hook.result.current.retry());
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(2);
    expect(hook.result.current.saveState).toBe('saved');
    expect(hook.result.current.error).toBeNull();
  });

  it('a save that throws is a generic failure', async () => {
    saves.autosaveDraft.mockRejectedValueOnce(new Error('network'));
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    expect(hook.result.current.saveState).toBe('failed');
    expect(hook.result.current.error).toBe('generic');
  });

  it('flush() awaits the running save, then stores the latest edit with the refreshing save', async () => {
    const answerFirst = heldSave();
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    hook.rerender({ draft: draftWith('3') });
    let flushed: unknown = null;
    let flushing!: Promise<unknown>;
    await act(async () => {
      flushing = hook.result.current.flush().then((result) => (flushed = result));
    });
    expect(saves.persistDraft).not.toHaveBeenCalled();
    expect(flushed).toBeNull();
    await answerFirst({ ok: true });
    await act(async () => void (await flushing));
    expect(saves.persistDraft).toHaveBeenCalledTimes(1);
    expect(saves.persistDraft.mock.calls[0][0].sections[0].lines[0].qty).toBe('3');
    expect(flushed).toEqual({ ok: true });
    await advance(5000);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
  });

  it('flush() with nothing unsaved stores nothing and answers ok', async () => {
    const hook = renderAutosave();
    let flushed: unknown = null;
    await act(async () => {
      flushed = await hook.result.current.flush();
    });
    expect(flushed).toEqual({ ok: true });
    expect(saves.persistDraft).not.toHaveBeenCalled();
  });

  it('closing the tab asks first only while something is unsaved', async () => {
    const hook = renderAutosave();
    const ask = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(ask()).toBe(false);
    hook.rerender({ draft: draftWith('2') });
    expect(ask()).toBe(true);
    await advance(1500);
    expect(ask()).toBe(false);
  });

  it('disabled: never saves on its own', async () => {
    const hook = renderHook(({ draft }) => useDraftAutosave({ draft, enabled: false }), {
      initialProps: { draft: draftWith('1') },
    });
    hook.rerender({ draft: draftWith('2') });
    await advance(5000);
    expect(saves.autosaveDraft).not.toHaveBeenCalled();
  });

  it('leaving the builder with an unsaved edit stores it', async () => {
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    hook.unmount();
    await act(async () => {});
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
  });
});
