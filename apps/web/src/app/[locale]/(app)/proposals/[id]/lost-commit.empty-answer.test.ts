import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftWith } from '@/test/draft-autosave-fixtures';
import { recoverLostCommit } from './lost-commit';

// The read of the stored draft can resolve with NOTHING where its type promises
// a result. Nothing was read, so nothing was compared: `'unreadable'`, never a
// conflict and never a rejection of the send that asked.

const stored = vi.hoisted(() => ({ readStoredDraftState: vi.fn() }));
vi.mock('./persist-draft', () => stored);

afterEach(() => {
  vi.resetAllMocks();
});

describe('recoverLostCommit: the read answers nothing', () => {
  it.each([[undefined], [null]])("a read that answers %s answers 'unreadable'", async (empty) => {
    stored.readStoredDraftState.mockResolvedValueOnce(empty);
    expect(await recoverLostCommit(draftWith('2'), draftWith('3'), [])).toBe('unreadable');
    expect(stored.readStoredDraftState).toHaveBeenCalledTimes(1);
  });
});
