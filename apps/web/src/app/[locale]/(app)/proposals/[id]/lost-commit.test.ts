import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftWith, lineWith, storedAs } from '@/test/draft-autosave-fixtures';
import { recoverLostCommit, type RecoveredCommit } from './lost-commit';

const stored = vi.hoisted(() => ({ readStoredDraftState: vi.fn() }));
vi.mock('./persist-draft', () => stored);

/** A line not stored yet, under a row key of the test's choosing. */
const marble = (key: string) => lineWith('5', { key, id: null, descriptionEn: 'Marble' });

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('recoverLostCommit: whose commit is stored', () => {
  it('the stored draft is the latest unconfirmed send: its revision, the ids by its row keys, and the current draft re-keyed', async () => {
    const latest = draftWith('2', [marble('k-2')]);
    const current = draftWith('3', [marble('k-2')]);
    stored.readStoredDraftState.mockResolvedValueOnce(storedAs(latest, 'r-9', ['l-1', 'l-new']));
    const recovered = (await recoverLostCommit(latest, current, [])) as RecoveredCommit;
    expect(stored.readStoredDraftState).toHaveBeenCalledTimes(1);
    expect(stored.readStoredDraftState).toHaveBeenCalledWith('p-1');
    expect(recovered.revision).toBe('r-9');
    expect([...recovered.idsByKey]).toEqual([['section-key-1', 's-1'], ['k-1', 'l-1'], ['k-2', 'l-new']]);
    expect(recovered.draft.sections[0].lines.map((line) => [line.qty, line.id])).toEqual([['3', 'l-1'], ['5', 'l-new']]);
  });

  it('the stored draft is an EARLIER unconfirmed send: recognised all the same, with the ids by that send\'s keys', async () => {
    const committed = draftWith('2', [marble('k-2')]);
    const current = draftWith('6', [marble('k-2')]);
    stored.readStoredDraftState.mockResolvedValueOnce(storedAs(committed, 'r-9', ['l-1', 'l-new']));
    const recovered = (await recoverLostCommit(draftWith('5'), current, [draftWith('4'), committed, draftWith('3')])) as RecoveredCommit;
    expect(recovered.revision).toBe('r-9');
    expect(recovered.idsByKey.get('k-2')).toBe('l-new');
    expect(recovered.draft.sections[0].lines.map((line) => [line.qty, line.id])).toEqual([['6', 'l-1'], ['5', 'l-new']]);
  });

  it('two sends match what is stored: the newest decides, because its row keys are the current draft\'s', async () => {
    const earlier = draftWith('2', [marble('k-removed-since')]);
    const latest = draftWith('2', [marble('k-added-again')]);
    const current = draftWith('3', [marble('k-added-again')]);
    stored.readStoredDraftState.mockResolvedValueOnce(storedAs(latest, 'r-9', ['l-1', 'l-new']));
    const recovered = (await recoverLostCommit(latest, current, [earlier])) as RecoveredCommit;
    expect(recovered.idsByKey.has('k-removed-since')).toBe(false);
    expect(recovered.draft.sections[0].lines[1].id).toBe('l-new');
  });

  it('two EARLIER sends match what is stored: the newer of them decides', async () => {
    const older = draftWith('2', [marble('k-removed-since')]);
    const newer = draftWith('2', [marble('k-added-again')]);
    const current = draftWith('4', [marble('k-added-again')]);
    stored.readStoredDraftState.mockResolvedValueOnce(storedAs(newer, 'r-9', ['l-1', 'l-new']));
    const recovered = (await recoverLostCommit(draftWith('3'), current, [newer, older])) as RecoveredCommit;
    expect(recovered.idsByKey.has('k-removed-since')).toBe(false);
    expect(recovered.draft.sections[0].lines[1].id).toBe('l-new');
  });

  it('the stored draft is none of them: null, a real conflict', async () => {
    stored.readStoredDraftState.mockResolvedValueOnce(storedAs(draftWith('7'), 'r-9', ['l-1']));
    expect(await recoverLostCommit(draftWith('3'), draftWith('4'), [draftWith('2')])).toBeNull();
  });
});

describe('recoverLostCommit: the stored draft could not be read', () => {
  it.each([
    ['throws', () => Promise.reject(new Error('fetch failed'))],
    ['is refused', () => Promise.resolve({ ok: false, error: 'forbidden' })],
    ['answers ok without a draft', () => Promise.resolve({ ok: true })],
    ['is refused and carries a draft all the same', () => Promise.resolve({ ...storedAs(draftWith('2'), 'r-9', ['l-1']), ok: false, error: 'forbidden' })],
  ])("a read that %s answers 'unreadable', not null", async (_how, read) => {
    stored.readStoredDraftState.mockImplementationOnce(read);
    expect(await recoverLostCommit(draftWith('2'), draftWith('3'), [])).toBe('unreadable');
  });

  it("a read that never answers is given up after 20 seconds, and answers 'unreadable'; a late answer changes nothing", async () => {
    vi.useFakeTimers();
    let answerLate: (answer: unknown) => void = () => {};
    stored.readStoredDraftState.mockImplementationOnce(() => new Promise((resolve) => (answerLate = resolve)));
    let outcome: unknown = 'waiting';
    void recoverLostCommit(draftWith('2'), draftWith('3'), []).then((answer) => {
      outcome = answer;
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(outcome).toBe('waiting');
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe('unreadable');
    expect(vi.getTimerCount()).toBe(0);
    answerLate(storedAs(draftWith('2'), 'r-9', ['l-1']));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe('unreadable');
  });
});
