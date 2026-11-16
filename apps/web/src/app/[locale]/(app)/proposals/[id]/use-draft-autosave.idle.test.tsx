import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { draftWith, receipt, storedAs } from '@/test/draft-autosave-fixtures';
import { collectUnhandledRejections } from '@/test/unhandled-rejections';
import { useDraftAutosave } from './use-draft-autosave';

// R2, through the real hook: one throw from a callback of the builder during a
// background save (`onStored`, `onRefused`, or `onStored` handing on recovered
// ids) used to stop all saving for the tab, and the last of the three also left
// the header on "Saving". The throw is still raised where nothing catches it.

const saves = vi.hoisted(() => ({
  autosaveDraft: vi.fn(),
  persistDraft: vi.fn(),
  readStoredDraftState: vi.fn(),
}));
vi.mock('./persist-draft', () => saves);

const STALE = { ok: false, error: 'draft_changed_elsewhere' };
const thrown = new Error('the callback threw');
const onStored = vi.fn();
const onRefused = vi.fn();
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const sentQuantities = () => saves.autosaveDraft.mock.calls.map((call) => call[0].sections[0].lines[0].qty);

function renderAutosave() {
  return renderHook(
    ({ draft }) => useDraftAutosave({ draft, revision: 'r-0', enabled: true, onStored, onIncomplete: () => {}, onRefused }),
    { initialProps: { draft: draftWith('1') } },
  );
}
type Hook = ReturnType<typeof renderAutosave>;

/** What must still work after the throw: an edit is saved, a flush stores, and leaving stores. */
async function expectTheBuilderStillSaves(hook: Hook, firstQuantity: string) {
  const before = saves.autosaveDraft.mock.calls.length;
  hook.rerender({ draft: draftWith(firstQuantity) });
  await advance(1500);
  expect(sentQuantities().slice(before)).toEqual([firstQuantity]);
  expect(hook.result.current.saveState).toBe('saved');
  hook.rerender({ draft: draftWith('8') });
  let flushed: unknown = 'waiting';
  await act(async () => {
    flushed = await hook.result.current.flush();
  });
  expect(flushed).toEqual(receipt('r-1', ['l-1']));
  expect(saves.persistDraft.mock.calls.at(-1)?.[0].sections[0].lines[0].qty).toBe('8');
  hook.rerender({ draft: draftWith('9') });
  hook.unmount();
  await act(async () => {});
  expect(sentQuantities().at(-1)).toBe('9');
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

describe('useDraftAutosave: a callback that throws during a background save (R2)', () => {
  it('onStored throws: the save is stored, the builder still saves, flushes and stores on leaving, and the throw is raised', async () => {
    const unhandled = collectUnhandledRejections();
    onStored.mockImplementationOnce(() => {
      throw thrown;
    });
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    expect(hook.result.current.saveState).toBe('saved');
    await expectTheBuilderStillSaves(hook, '3');
    expect(await unhandled.stop()).toEqual([thrown]);
  });

  it('onRefused throws: "Not saved" with its reason, Retry sends again, the builder still saves, and the throw is raised', async () => {
    const unhandled = collectUnhandledRejections();
    saves.autosaveDraft.mockResolvedValueOnce({ ok: false, error: 'draft_incomplete' });
    onRefused.mockImplementationOnce(() => {
      throw thrown;
    });
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    expect(hook.result.current.saveState).toBe('failed');
    expect(hook.result.current.failure?.error).toBe('draft_incomplete');
    await act(async () => hook.result.current.retry());
    expect(sentQuantities()).toEqual(['2', '2']);
    expect(hook.result.current.saveState).toBe('saved');
    await expectTheBuilderStillSaves(hook, '3');
    expect(await unhandled.stop()).toEqual([thrown]);
  });

  it('onStored throws on the ids of a recovered save: the header leaves "Saving", the builder still saves from the recovered revision, and the throw is raised', async () => {
    const unhandled = collectUnhandledRejections();
    saves.autosaveDraft.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(STALE);
    saves.readStoredDraftState.mockResolvedValueOnce(storedAs(draftWith('2'), 'r-9', ['l-1']));
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    onStored.mockImplementationOnce(() => {
      throw thrown;
    });
    hook.rerender({ draft: draftWith('3') });
    await advance(1500);
    expect(hook.result.current.saveState).toBe('dirty');
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(2);
    await expectTheBuilderStillSaves(hook, '4');
    expect(saves.autosaveDraft.mock.calls[2][1]).toBe('r-9');
    expect(await unhandled.stop()).toEqual([thrown]);
  });

  it('the same throw during a flush rejects the flush with it, leaves "Saving", and the next flush stores', async () => {
    saves.autosaveDraft.mockRejectedValueOnce(new Error('fetch failed'));
    saves.persistDraft.mockResolvedValueOnce(STALE);
    saves.readStoredDraftState.mockResolvedValueOnce(storedAs(draftWith('2'), 'r-9', ['l-1']));
    const hook = renderAutosave();
    hook.rerender({ draft: draftWith('2') });
    await advance(1500);
    onStored.mockImplementationOnce(() => {
      throw thrown;
    });
    hook.rerender({ draft: draftWith('3') });
    let outcome: unknown = 'waiting';
    await act(async () => {
      outcome = await hook.result.current.flush().catch((cause: unknown) => cause);
    });
    expect(outcome).toBe(thrown);
    expect(hook.result.current.saveState).toBe('dirty');
    await act(async () => {
      outcome = await hook.result.current.flush();
    });
    expect(outcome).toEqual(receipt('r-1', ['l-1']));
    expect(saves.persistDraft.mock.calls.at(-1)?.[1]).toBe('r-9');
    expect(hook.result.current.saveState).toBe('saved');
  });
});
