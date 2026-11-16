import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { draftWith, lineWith, neverAnswers, receipt, storedAs } from '@/test/draft-autosave-fixtures';
import { withStoredIds } from './draft-save-receipt';
import { useDraftAutosave } from './use-draft-autosave';

// Retry during an outage. The builder hands the hook a NEW draft object on
// every render (builder-client.tsx), so the same unsaved draft pressed Retry on
// again and again is as many objects. They are one unconfirmed send: counted
// one by one they filled the list of unconfirmed sends and pushed out the send
// that had in fact committed, and the studio was told somebody else had changed
// the draft.
// Through the real hook, flight and recovery; only the server calls are doubled.

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
const sentDrafts = () => saves.autosaveDraft.mock.calls.map((call) => call[0]);
const sentRevisions = () => saves.autosaveDraft.mock.calls.map((call) => call[1]);
/** With A, B and C, enough sends to fill the list of 32 if each Retry took a place of its own. */
const RETRIES = 31;

/** The builder as it is rendered: a fresh draft object on every render. */
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
  const retry = async (wait: number) => {
    act(() => hook.result.current.autosave.retry());
    await advance(wait);
  };
  return { hook, type, retry };
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

describe('useDraftAutosave: Retry on the same unsaved draft is one unconfirmed send', () => {
  it('A is silent, B commits but loses its answer, C is silent, 31 silent Retries of C: B is still recognised', async () => {
    saves.autosaveDraft
      .mockImplementationOnce(neverAnswers)
      .mockImplementationOnce(lost)
      .mockImplementationOnce(neverAnswers);
    for (let n = 0; n < RETRIES; n += 1) saves.autosaveDraft.mockImplementationOnce(neverAnswers);
    saves.autosaveDraft.mockResolvedValueOnce(STALE).mockResolvedValueOnce(receipt('r-10', ['l-1', 'l-new']));
    saves.readStoredDraftState.mockResolvedValueOnce(storedAs(draftWith('3', [marble]), 'r-9', ['l-1', 'l-new']));
    const { hook, type, retry } = renderBuilder();
    await type('2', 1500 + 20_000);
    await type('3');
    await type('4', 1500 + 20_000);
    for (let n = 0; n < RETRIES; n += 1) await retry(20_000);
    expect(hook.result.current.autosave.failure?.error).toBe('uncertain');
    // The premise: each Retry sent a draft object of its own.
    expect(new Set(sentDrafts().slice(2)).size).toBe(RETRIES + 1);

    await retry(0);
    expect(saves.readStoredDraftState).toHaveBeenCalledTimes(1);
    expect(sentRevisions().at(-1)).toBe('r-9');
    expect(saves.autosaveDraft).toHaveBeenCalledTimes(RETRIES + 5);
    expect(hook.result.current.autosave.saveState).toBe('saved');
    expect(hook.result.current.autosave.failure).toBeNull();
    expect(hook.result.current.sections[0].lines[1].id).toBe('l-new');
    expect(vi.getTimerCount()).toBe(0);
  });
});
