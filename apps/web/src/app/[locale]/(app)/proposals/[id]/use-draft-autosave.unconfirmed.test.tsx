import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { draftWith, lineWith, neverAnswers, receipt, storedAs } from '@/test/draft-autosave-fixtures';
import { withStoredIds } from './draft-save-receipt';
import { useDraftAutosave } from './use-draft-autosave';

// A connection drop longer than one save: send A committed but lost its answer,
// send B failed too. Only B used to be remembered, so the stored draft (A) was
// compared with the wrong send and the studio was told somebody else had changed
// the draft, which cost every edit since A. Through the real hook, flight and
// recovery; only the three server calls are doubled.

const saves = vi.hoisted(() => ({
  autosaveDraft: vi.fn(),
  persistDraft: vi.fn(),
  readStoredDraftState: vi.fn(),
}));
vi.mock('./persist-draft', () => saves);

const STALE = { ok: false, error: 'draft_changed_elsewhere' };
const lost = () => Promise.reject(new Error('fetch failed'));
const marble = lineWith('5', { key: 'k-2', id: null, descriptionEn: 'Marble' });
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const sentRevisions = () => saves.autosaveDraft.mock.calls.map((call) => call[1]);
const lastSent = () => saves.autosaveDraft.mock.calls.at(-1)?.[0].sections[0].lines;

/** The builder with a Marble line not stored yet; `type(qty)` edits the Gypsum quantity and lets `wait` ms pass. */
function renderBuilder() {
  const hook = renderHook(() => {
    const [sections, setSections] = useState(draftWith('1', [marble]).sections);
    const autosave = useDraftAutosave({
      draft: { ...draftWith('1'), sections },
      revision: 'r-0',
      enabled: true,
      onStored: (ids) => setSections((current) => withStoredIds(current, ids)),
      onIncomplete: () => {},
      onRefused: () => {},
    });
    return { autosave, sections, setSections };
  });
  const type = async (qty: string, wait = 1500) => {
    act(() => hook.result.current.setSections((now) => [{ ...now[0], lines: [lineWith(qty), ...now[0].lines.slice(1)] }]));
    await advance(wait);
  };
  return { hook, type };
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

describe('useDraftAutosave: every unconfirmed send since the last confirmed save is remembered', () => {
  it('A committed but lost its answer, B failed too, C is refused as stale: recognised as A, its ids adopted, C saved', async () => {
    saves.autosaveDraft
      .mockImplementationOnce(lost)
      .mockImplementationOnce(lost)
      .mockResolvedValueOnce(STALE)
      .mockResolvedValueOnce(receipt('r-10', ['l-1', 'l-new']));
    saves.readStoredDraftState.mockResolvedValueOnce(storedAs(draftWith('2', [marble]), 'r-9', ['l-1', 'l-new']));
    const { hook, type } = renderBuilder();
    await type('2');
    await type('3');
    await type('4');
    expect(saves.readStoredDraftState).toHaveBeenCalledTimes(1);
    expect(sentRevisions()).toEqual(['r-0', 'r-0', 'r-0', 'r-9']);
    expect(lastSent().map((line: { qty: string; id: string | null }) => [line.qty, line.id])).toEqual([['4', 'l-1'], ['5', 'l-new']]);
    expect(hook.result.current.autosave.saveState).toBe('saved');
    expect(hook.result.current.autosave.failure).toBeNull();
    expect(hook.result.current.sections[0].lines[1].id).toBe('l-new');
  });

  it('the same with a slow server: A and B both pass the deadline, A commits late, C is refused: recognised as A', async () => {
    saves.autosaveDraft
      .mockImplementationOnce(neverAnswers)
      .mockImplementationOnce(neverAnswers)
      .mockResolvedValueOnce(STALE)
      .mockResolvedValueOnce(receipt('r-10', ['l-1', 'l-new']));
    saves.readStoredDraftState.mockResolvedValueOnce(storedAs(draftWith('2', [marble]), 'r-9', ['l-1', 'l-new']));
    const { hook, type } = renderBuilder();
    await type('2', 1500 + 20_000);
    await type('3', 1500 + 20_000);
    await type('4');
    expect(sentRevisions()).toEqual(['r-0', 'r-0', 'r-0', 'r-9']);
    expect(hook.result.current.autosave.saveState).toBe('saved');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('B, the later of the two, is the one that committed: recognised as B', async () => {
    saves.autosaveDraft
      .mockImplementationOnce(lost)
      .mockImplementationOnce(lost)
      .mockResolvedValueOnce(STALE)
      .mockResolvedValueOnce(receipt('r-10', ['l-1', 'l-new']));
    saves.readStoredDraftState.mockResolvedValueOnce(storedAs(draftWith('3', [marble]), 'r-9', ['l-1', 'l-new']));
    const { hook, type } = renderBuilder();
    await type('2');
    await type('3');
    await type('4');
    expect(sentRevisions()).toEqual(['r-0', 'r-0', 'r-0', 'r-9']);
    expect(hook.result.current.autosave.saveState).toBe('saved');
  });

  it('a confirmed save in between forgets them: a stale refusal after it reads nothing and is a real conflict', async () => {
    saves.autosaveDraft
      .mockImplementationOnce(lost)
      .mockResolvedValueOnce(receipt('r-1', ['l-1', 'l-new']))
      .mockResolvedValueOnce(STALE);
    const { hook, type } = renderBuilder();
    await type('2');
    await type('3');
    await type('4');
    expect(saves.readStoredDraftState).not.toHaveBeenCalled();
    expect(hook.result.current.autosave.failure?.error).toBe('draft_changed_elsewhere');
  });
});
