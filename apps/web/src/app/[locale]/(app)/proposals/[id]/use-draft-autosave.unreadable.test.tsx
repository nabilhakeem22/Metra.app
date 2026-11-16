import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { draftWith, neverAnswers, receipt, storedAs } from '@/test/draft-autosave-fixtures';
import { useDraftAutosave } from './use-draft-autosave';

// The read that settles a lost save can fail or hang like the save itself.
// Through the real hook, flight and lost-commit recovery: a read that could not
// be made says "could not confirm" and Retry settles it; only a read that
// SUCCEEDED and matches nothing says "changed in another tab".

const saves = vi.hoisted(() => ({
  autosaveDraft: vi.fn(),
  persistDraft: vi.fn(),
  readStoredDraftState: vi.fn(),
}));
vi.mock('./persist-draft', () => saves);

const STALE = { ok: false, error: 'draft_changed_elsewhere' };
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const sentRevisions = () => saves.autosaveDraft.mock.calls.map((call) => call[1]);

/**
 * Quantity 2 is sent and its answer is lost (it committed, as revision r-9);
 * quantity 3 is then sent and refused as stale, so the stored draft is read.
 */
async function lostSaveThenStaleRefusal() {
  saves.autosaveDraft.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(STALE);
  const hook = renderHook(
    ({ draft }) =>
      useDraftAutosave({ draft, revision: 'r-0', enabled: true, onStored: () => {}, onIncomplete: () => {}, onRefused: () => {} }),
    { initialProps: { draft: draftWith('1') } },
  );
  hook.rerender({ draft: draftWith('2') });
  await advance(1500);
  hook.rerender({ draft: draftWith('3') });
  await advance(1500);
  return hook;
}

/** Retry, with the server answering as it would: stale again, the stored draft readable, then the save stored. */
async function retryWithTheServerBack(hook: Awaited<ReturnType<typeof lostSaveThenStaleRefusal>>) {
  saves.autosaveDraft.mockResolvedValueOnce(STALE).mockResolvedValueOnce(receipt('r-10', ['l-1']));
  saves.readStoredDraftState.mockResolvedValueOnce(storedAs(draftWith('2'), 'r-9', ['l-1']));
  await act(async () => hook.result.current.retry());
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('useDraftAutosave: the stored draft could not be read', () => {
  it.each([
    ['throws', () => Promise.reject(new Error('fetch failed'))],
    ['is refused', () => Promise.resolve({ ok: false, error: 'forbidden' })],
    ['answers ok without a draft', () => Promise.resolve({ ok: true })],
    ['is refused and carries a draft all the same', () => Promise.resolve({ ...storedAs(draftWith('2'), 'r-9', ['l-1']), ok: false, error: 'forbidden' })],
  ])('a read that %s: "could not confirm", not "changed in another tab", and Retry recovers the save', async (_how, read) => {
    saves.readStoredDraftState.mockImplementationOnce(read);
    const hook = await lostSaveThenStaleRefusal();
    expect(saves.readStoredDraftState).toHaveBeenCalledTimes(1);
    expect(hook.result.current.saveState).toBe('failed');
    expect(hook.result.current.failure?.error).toBe('uncertain');
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(2);
    await retryWithTheServerBack(hook);
    expect(saves.readStoredDraftState).toHaveBeenCalledTimes(2);
    expect(sentRevisions()).toEqual(['r-0', 'r-0', 'r-0', 'r-9']);
    expect(hook.result.current.saveState).toBe('saved');
    expect(hook.result.current.failure).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a read that never answers is given up after 20 seconds: still saving at 19,999 ms, "could not confirm" at 20,000, and Retry recovers', async () => {
    saves.readStoredDraftState.mockImplementationOnce(neverAnswers);
    const hook = await lostSaveThenStaleRefusal();
    await advance(19_999);
    expect(hook.result.current.saveState).toBe('saving');
    await advance(1);
    expect(hook.result.current.saveState).toBe('failed');
    expect(hook.result.current.failure?.error).toBe('uncertain');
    expect(vi.getTimerCount()).toBe(0);
    await retryWithTheServerBack(hook);
    expect(sentRevisions()).toEqual(['r-0', 'r-0', 'r-0', 'r-9']);
    expect(hook.result.current.saveState).toBe('saved');
  });

  it('a read that answers after it was given up on is ignored: nothing is adopted and nothing is sent', async () => {
    let answerLate: (stored: unknown) => void = () => {};
    saves.readStoredDraftState.mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)));
    const hook = await lostSaveThenStaleRefusal();
    await advance(20_000);
    await act(async () => answerLate(storedAs(draftWith('2'), 'r-9', ['l-1'])));
    expect(hook.result.current.failure?.error).toBe('uncertain');
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(2);
  });

  it('a read that SUCCEEDS and matches nothing is a real conflict, as before: "changed in another tab", nothing sent again', async () => {
    saves.readStoredDraftState.mockResolvedValueOnce(storedAs(draftWith('7'), 'r-9', ['l-1']));
    const hook = await lostSaveThenStaleRefusal();
    expect(hook.result.current.saveState).toBe('failed');
    expect(hook.result.current.failure?.error).toBe('draft_changed_elsewhere');
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(2);
  });
});
