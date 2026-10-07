import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { LineState } from './builder-model';
import { withLineIds } from './draft-save-receipt';
import type { ProposalDraftState } from './proposal-payload';
import { useDraftAutosave } from './use-draft-autosave';

const saves = vi.hoisted(() => ({ autosaveDraft: vi.fn(), persistDraft: vi.fn() }));
vi.mock('./persist-draft', () => saves);

function lineWith(qty: string, overrides: Partial<LineState> = {}): LineState {
  return {
    key: 'k-1',
    id: 'l-1',
    costItemId: null,
    descriptionEn: 'Gypsum',
    descriptionAr: '',
    qty,
    unit: 'sqm',
    unitCost: '60',
    unitPrice: '100',
    discountPct: '0',
    ...overrides,
  };
}

function draftWith(qty: string, extraLines: LineState[] = []): ProposalDraftState {
  return {
    id: 'p-1',
    discountPct: '0',
    taxRate: '0',
    supervisionPct: '0',
    seeMargin: true,
    sections: [{ titleEn: 'Ceilings', titleAr: '', lines: [lineWith(qty), ...extraLines] }],
  };
}

const receipt = (revision: string, lineIds: string[]) => ({
  ok: true,
  data: { revision, sections: [{ id: 's-1', lineIds }] },
});

/** A save the test answers by hand. */
function heldSave(mock = saves.autosaveDraft) {
  let answer: (result: unknown) => void = () => {};
  mock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  return (result: unknown) => act(async () => answer(result));
}

const onIncomplete = vi.fn();

/** The hook driven by props: each rerender is an edit. */
function renderAutosave(enabled = true) {
  return renderHook(
    ({ draft }) =>
      useDraftAutosave({ draft, revision: 'r-0', enabled, onStored: () => {}, onIncomplete }),
    { initialProps: { draft: draftWith('1') } },
  );
}

/** The hook as the builder holds it: the receipt's ids are adopted into the draft. */
function useAdoptingBuilder(initial: ProposalDraftState) {
  const [sections, setSections] = useState(initial.sections);
  const autosave = useDraftAutosave({
    draft: { ...initial, sections },
    revision: 'r-0',
    enabled: true,
    onStored: (ids) => setSections((current) => withLineIds(current, ids)),
    onIncomplete,
  });
  return { autosave, sections, setSections };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  saves.autosaveDraft.mockResolvedValue(receipt('r-1', ['l-1']));
  saves.persistDraft.mockResolvedValue(receipt('r-1', ['l-1']));
});

afterEach(async () => {
  // Unmounting stores an unsaved edit; let that settle before the mocks reset.
  cleanup();
  await act(async () => {});
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useDraftAutosave: when it saves', () => {
  it('3 edits within 1 s save once, 1500 ms after the last, with the loaded revision', async () => {
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
    expect(saves.autosaveDraft.mock.calls[0][1]).toBe('r-0');
    expect(hook.result.current.saveState).toBe('saved');
    expect(hook.result.current.lastSavedAt).toBeInstanceOf(Date);
  });

  it('each save sends the revision the previous save answered', async () => {
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    saves.autosaveDraft.mockResolvedValueOnce(receipt('r-2', ['l-1']));
    hook.rerender({ draft: draftWith('3') });
    await advance(1500);
    expect(saves.autosaveDraft.mock.calls.map((call) => call[1])).toEqual(['r-0', 'r-1']);
  });

  it('R10: continuous editing every 400 ms still saves within 10 s', async () => {
    const hook = renderAutosave();
    for (let step = 1; step <= 25; step += 1) {
      hook.rerender({ draft: draftWith(String(step + 1)) });
      await advance(400);
    }
    // 25 edits over 10 s: the ceiling fired once, the debounce alone never would.
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
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
    await answerFirst(receipt('r-1', ['l-1']));
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(2);
    expect(saves.autosaveDraft.mock.calls[1][0].sections[0].lines[0].qty).toBe('4');
    await advance(5000);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(2);
    expect(hook.result.current.saveState).toBe('saved');
  });

  it('disabled: never saves on its own', async () => {
    const hook = renderAutosave(false);
    hook.rerender({ draft: draftWith('2') });
    await advance(5000);
    expect(saves.autosaveDraft).not.toHaveBeenCalled();
  });
});

describe('useDraftAutosave: F1, a new line becomes a stored line on its first save', () => {
  it('the receipt id is adopted, every later save names it, and the owner override 150 rides every save', async () => {
    const marble = lineWith('2', {
      key: 'k-2',
      id: null,
      costItemId: 'ci-1',
      descriptionEn: 'Marble',
      unitCost: '150',
      unitPrice: '200',
    });
    saves.autosaveDraft
      .mockResolvedValueOnce(receipt('r-1', ['l-1', 'l-new']))
      .mockResolvedValueOnce(receipt('r-2', ['l-1', 'l-new']))
      .mockResolvedValueOnce(receipt('r-3', ['l-1', 'l-new']));
    const hook = renderHook(() => useAdoptingBuilder(draftWith('1', [marble])));
    for (const qty of ['3', '4', '5']) {
      act(() =>
        hook.result.current.setSections((current) => [
          { ...current[0], lines: [lineWith(qty), ...current[0].lines.slice(1)] },
        ]),
      );
      await advance(1500);
    }
    const sent = saves.autosaveDraft.mock.calls.map((call) => call[0].sections[0].lines[1]);
    expect(sent.map((line) => line.id)).toEqual([null, 'l-new', 'l-new']);
    expect(sent.map((line) => line.unitCost)).toEqual(['150', '150', '150']);
    expect(hook.result.current.sections[0].lines[1].id).toBe('l-new');
    expect(hook.result.current.autosave.saveState).toBe('saved');
    // Adopting the ids is not an edit: nothing more is sent.
    await advance(15_000);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(3);
  });
});

describe('useDraftAutosave: failures and the state it shows', () => {
  it('a refusal stops at failed with its code; nothing retries until retry()', async () => {
    saves.autosaveDraft.mockResolvedValueOnce({ ok: false, error: 'draft_changed_elsewhere' });
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    expect(hook.result.current.saveState).toBe('failed');
    expect(hook.result.current.error).toBe('draft_changed_elsewhere');
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

  it('F6: editing back to the stored value after a failure is saved again, and the tab-close prompt disarms', async () => {
    saves.autosaveDraft.mockResolvedValueOnce({ ok: false, error: 'generic' });
    const hook = renderAutosave();
    const prompts = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    expect(hook.result.current.saveState).toBe('failed');
    expect(prompts()).toBe(true);
    hook.rerender({ draft: draftWith('1') });
    await advance(5000);
    expect(hook.result.current.saveState).toBe('saved');
    expect(prompts()).toBe(false);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
  });

  it('F3: a blank line just added is not an error: no save, "Unsaved changes" with the hint', async () => {
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('1', [lineWith('1', { key: 'k-2', id: null, descriptionEn: '' })]) });
    await advance(15_000);
    expect(saves.autosaveDraft).not.toHaveBeenCalled();
    expect(hook.result.current.saveState).toBe('dirty');
    expect(hook.result.current.incomplete).toBe(true);
    expect(hook.result.current.error).toBeNull();
  });

  it('F3: flush() with a blank line names the field and stores nothing', async () => {
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('1', [lineWith('1', { key: 'k-2', id: null, descriptionEn: '' })]) });
    let flushed: unknown = null;
    await act(async () => {
      flushed = await hook.result.current.flush();
    });
    expect(flushed).toEqual({ ok: false, error: 'draft_incomplete' });
    expect(onIncomplete).toHaveBeenCalledWith({ kind: 'line', sectionIndex: 0, lineIndex: 1, input: 'description' });
    expect(saves.persistDraft).not.toHaveBeenCalled();
    expect(hook.result.current.saveState).toBe('failed');
  });

  it('R2: a draft past the action body limit is refused here with draft_too_large, never sent', async () => {
    const hook = renderAutosave();
    const huge = lineWith('1', { key: 'k-2', descriptionEn: 'x'.repeat(4 * 1024 * 1024) });
    hook.rerender({ draft: draftWith('1', [huge]) });
    await advance(1500);
    expect(saves.autosaveDraft).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe('draft_too_large');
  });
});

describe('useDraftAutosave: flush and leaving', () => {
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
    await answerFirst(receipt('r-1', ['l-1']));
    await act(async () => void (await flushing));
    expect(saves.persistDraft).toHaveBeenCalledTimes(1);
    expect(saves.persistDraft.mock.calls[0][0].sections[0].lines[0].qty).toBe('3');
    expect(saves.persistDraft.mock.calls[0][1]).toBe('r-1');
    expect(flushed).toEqual(receipt('r-1', ['l-1']));
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

  it('leaving with an unsaved edit stores it', async () => {
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    hook.unmount();
    await act(async () => {});
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
  });

  it('R8: leaving while that same edit is being saved sends no second copy', async () => {
    const answer = heldSave();
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    hook.unmount();
    await answer(receipt('r-1', ['l-1']));
    await act(async () => {});
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
  });

  it('leaving with an unfinished line sends nothing the server would refuse', async () => {
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('1', [lineWith('1', { key: 'k-2', id: null, descriptionEn: '' })]) });
    hook.unmount();
    await act(async () => {});
    expect(saves.autosaveDraft).not.toHaveBeenCalled();
  });
});
