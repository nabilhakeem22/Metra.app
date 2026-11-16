import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { draftWith, lineWith, neverAnswers, receipt, storedAs } from '@/test/draft-autosave-fixtures';
import { collectUnhandledRejections } from '@/test/unhandled-rejections';
import { withStoredIds } from './draft-save-receipt';
import type { ProposalDraftState } from './proposal-payload';
import { useDraftAutosave } from './use-draft-autosave';

// R1, through the real hook, flight and lost-commit recovery: a draft save that
// never answers used to leave the builder on "Saving" for the life of the tab,
// with one save sent, Send and the leave guard hanging, and the leave save never
// sent. Only the three server calls are doubled.

const saves = vi.hoisted(() => ({
  autosaveDraft: vi.fn(),
  persistDraft: vi.fn(),
  readStoredDraftState: vi.fn(),
}));
vi.mock('./persist-draft', () => saves);

const onRefused = vi.fn();
const onStored = vi.fn();

function renderAutosave() {
  return renderHook(
    ({ draft }) =>
      useDraftAutosave({ draft, revision: 'r-0', enabled: true, onStored, onIncomplete: () => {}, onRefused }),
    { initialProps: { draft: draftWith('1') } },
  );
}

/** The hook as the builder holds it: the ids a save stored are adopted into the draft. */
function useAdoptingBuilder(initial: ProposalDraftState) {
  const [sections, setSections] = useState(initial.sections);
  const autosave = useDraftAutosave({
    draft: { ...initial, sections },
    revision: 'r-0',
    enabled: true,
    onStored: (ids) => setSections((current) => withStoredIds(current, ids)),
    onIncomplete: () => {},
    onRefused,
  });
  return { autosave, sections, setSections };
}

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const sentQuantities = () => saves.autosaveDraft.mock.calls.map((call) => call[0].sections[0].lines[0].qty);
const sentRevisions = () => saves.autosaveDraft.mock.calls.map((call) => call[1]);

/** Edit to quantity 2 and let the debounce send it: the save under test is now in flight. */
async function editAndSend() {
  const hook = renderAutosave();
  hook.rerender({ draft: draftWith('2') });
  await advance(1500);
  expect(hook.result.current.saveState).toBe('saving');
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  saves.autosaveDraft.mockResolvedValue(receipt('r-1', ['l-1']));
  saves.persistDraft.mockResolvedValue(receipt('r-1', ['l-1']));
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('useDraftAutosave: a save that never answers is given up after 20 seconds (R1)', () => {
  it('19,999 ms: still saving. 20,000 ms: "Not saved", uncertain, with Retry, and no timer left', async () => {
    saves.autosaveDraft.mockImplementationOnce(neverAnswers);
    const hook = await editAndSend();
    await advance(19_999);
    expect(hook.result.current.saveState).toBe('saving');
    expect(hook.result.current.failure).toBeNull();
    await advance(1);
    expect(hook.result.current.saveState).toBe('failed');
    expect(hook.result.current.failure).toEqual({ error: 'uncertain', reference: undefined });
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onRefused.mock.calls[0][0]).toEqual({ ok: false, error: 'uncertain' });
    expect(onRefused.mock.calls[0][2]).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await advance(600_000);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
  });

  it('Retry after the deadline sends the save again, from the same revision, and it is saved', async () => {
    saves.autosaveDraft.mockImplementationOnce(neverAnswers);
    const hook = await editAndSend();
    await advance(20_000);
    await act(async () => hook.result.current.retry());
    expect(sentQuantities()).toEqual(['2', '2']);
    expect(sentRevisions()).toEqual(['r-0', 'r-0']);
    expect(hook.result.current.saveState).toBe('saved');
    expect(saves.readStoredDraftState).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an edit after the deadline is saved by the next autosave', async () => {
    saves.autosaveDraft.mockImplementationOnce(neverAnswers);
    const hook = await editAndSend();
    await advance(20_000);
    hook.rerender({ draft: draftWith('3') });
    await advance(1500);
    expect(sentQuantities()).toEqual(['2', '3']);
    expect(hook.result.current.saveState).toBe('saved');
  });

  it('an edit made while the save hung is sent the moment the deadline passes', async () => {
    saves.autosaveDraft.mockImplementationOnce(neverAnswers);
    const hook = await editAndSend();
    hook.rerender({ draft: draftWith('4') });
    await advance(19_999);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(sentQuantities()).toEqual(['2', '4']);
    expect(hook.result.current.saveState).toBe('saved');
  });

  it('flush (Send, Back, the leave guard) settles: it stores the latest edit once the deadline passes', async () => {
    saves.autosaveDraft.mockImplementationOnce(neverAnswers);
    const hook = await editAndSend();
    hook.rerender({ draft: draftWith('4') });
    let flushed: unknown = 'waiting';
    await act(async () => {
      void hook.result.current.flush().then((result) => (flushed = result));
    });
    await advance(19_999);
    expect(flushed).toBe('waiting');
    expect(saves.persistDraft).not.toHaveBeenCalled();
    await advance(1);
    expect(flushed).toEqual(receipt('r-1', ['l-1']));
    expect(saves.persistDraft).toHaveBeenCalledTimes(1);
    expect(saves.persistDraft.mock.calls[0][0].sections[0].lines[0].qty).toBe('4');
    expect(hook.result.current.saveState).toBe('saved');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaving with a newer edit while the save hangs: the leave save goes out at the deadline', async () => {
    saves.autosaveDraft.mockImplementationOnce(neverAnswers);
    const hook = await editAndSend();
    hook.rerender({ draft: draftWith('4') });
    hook.unmount();
    await advance(19_999);
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(sentQuantities()).toEqual(['2', '4']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/** A save the test answers by hand, whenever it likes. */
function heldSave() {
  let settle!: { resolve: (result: unknown) => void; reject: (cause: unknown) => void };
  saves.autosaveDraft.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  return {
    answer: (result: unknown) => act(async () => settle.resolve(result)),
    fail: (cause: unknown) => act(async () => settle.reject(cause)),
  };
}

describe('useDraftAutosave: the answer of a save that was given up on is ignored', () => {
  it('an answer 1 ms before the deadline is still the answer', async () => {
    const held = heldSave();
    const hook = await editAndSend();
    await advance(19_999);
    await held.answer(receipt('r-1', ['l-1']));
    expect(hook.result.current.saveState).toBe('saved');
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(hook.result.current.saveState).toBe('saved');
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('a late ok changes nothing: still "Not saved", nothing adopted, the next save goes from the old revision', async () => {
    const held = heldSave();
    const hook = await editAndSend();
    await advance(20_000);
    onStored.mockClear();
    await held.answer(receipt('r-late', ['l-1']));
    expect(hook.result.current.saveState).toBe('failed');
    expect(hook.result.current.failure?.error).toBe('uncertain');
    expect(hook.result.current.lastSavedAt).toBeNull();
    expect(onStored).not.toHaveBeenCalled();
    await act(async () => hook.result.current.retry());
    expect(sentRevisions()).toEqual(['r-0', 'r-0']);
  });

  it('a late refusal changes nothing: the studio is not told a second reason', async () => {
    const held = heldSave();
    const hook = await editAndSend();
    await advance(20_000);
    await held.answer({ ok: false, error: 'draft_changed_elsewhere' });
    expect(hook.result.current.failure?.error).toBe('uncertain');
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(saves.readStoredDraftState).not.toHaveBeenCalled();
  });

  it('a late rejection changes nothing and is not left unhandled', async () => {
    const unhandled = collectUnhandledRejections();
    const held = heldSave();
    const hook = await editAndSend();
    await advance(20_000);
    await held.fail(new Error('the connection dropped'));
    expect(hook.result.current.failure?.error).toBe('uncertain');
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(await unhandled.stop()).toEqual([]);
  });
});

describe('useDraftAutosave: what the save that was given up on did on the server', () => {
  it('it DID commit: the next save is refused as stale, recognised as ours, its ids adopted, and sent again once', async () => {
    const marble = lineWith('5', { key: 'k-2', id: null, descriptionEn: 'Marble' });
    const committed = draftWith('2', [marble]);
    saves.autosaveDraft
      .mockImplementationOnce(neverAnswers)
      .mockResolvedValueOnce({ ok: false, error: 'draft_changed_elsewhere' })
      .mockResolvedValueOnce(receipt('r-10', ['l-1', 'l-new']));
    saves.readStoredDraftState.mockResolvedValueOnce(storedAs(committed, 'r-9', ['l-1', 'l-new']));
    const hook = renderHook(() => useAdoptingBuilder(draftWith('1', [marble])));
    const typeQuantity = (qty: string) =>
      act(() => hook.result.current.setSections((now) => [{ ...now[0], lines: [lineWith(qty), ...now[0].lines.slice(1)] }]));
    typeQuantity('2');
    await advance(1500);
    await advance(20_000);
    expect(hook.result.current.autosave.failure?.error).toBe('uncertain');
    typeQuantity('3');
    await advance(1500);
    expect(saves.readStoredDraftState).toHaveBeenCalledTimes(1);
    expect(sentRevisions()).toEqual(['r-0', 'r-0', 'r-9']);
    expect(sentQuantities()).toEqual(['2', '3', '3']);
    expect(saves.autosaveDraft.mock.calls.map((call) => call[0].sections[0].lines[1].id)).toEqual([null, null, 'l-new']);
    expect(hook.result.current.sections[0].lines[1].id).toBe('l-new');
    expect(hook.result.current.autosave.saveState).toBe('saved');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('it did NOT commit: the next save is simply stored, and nothing is read', async () => {
    saves.autosaveDraft.mockImplementationOnce(neverAnswers).mockResolvedValueOnce(receipt('r-1', ['l-1']));
    const hook = await editAndSend();
    await advance(20_000);
    hook.rerender({ draft: draftWith('3') });
    await advance(1500);
    expect(sentRevisions()).toEqual(['r-0', 'r-0']);
    expect(saves.readStoredDraftState).not.toHaveBeenCalled();
    expect(hook.result.current.saveState).toBe('saved');
    expect(hook.result.current.failure).toBeNull();
  });
});
