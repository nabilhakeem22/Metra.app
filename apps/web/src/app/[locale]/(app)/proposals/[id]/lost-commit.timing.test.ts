import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftWith, storedAs } from '@/test/draft-autosave-fixtures';
import { createTurnJournal, deferred } from '@/test/turn-journal';
import { recoverLostCommit } from './lost-commit';

// The read of the stored draft got a deadline. It must not cost a microtask
// turn: before, the recovery was one async function with a bare `await` of the
// read in a `try`, and the save flight's journals are stamped by the turn. The
// existing journals double this module, so they cannot see its own timing; this
// file can. Found by the functional tester (one turn late on every path).

const stored = vi.hoisted(() => ({ readStoredDraftState: vi.fn() }));
vi.mock('./persist-draft', () => stored);

/** The recovery as it was shaped before the deadline: one async function, a bare await of the read in a try. */
async function bareRecovery(read: () => Promise<unknown>): Promise<void> {
  try {
    await read();
  } catch {
    return;
  }
}

const READS: Array<[string, (read: ReturnType<typeof deferred<unknown>>) => void]> = [
  ['is one of our sends', (read) => read.resolve(storedAs(draftWith('2'), 'r-9', ['l-1']))],
  ['is nobody we know', (read) => read.resolve(storedAs(draftWith('777'), 'r-9', ['l-1']))],
  ['is refused', (read) => read.resolve({ ok: false, error: 'generic' })],
  ['answers nothing', (read) => read.resolve(undefined)],
  ['rejects', (read) => read.reject(new Error('fetch failed'))],
];

afterEach(() => {
  vi.resetAllMocks();
});

describe('recoverLostCommit: the deadline costs no microtask turn', () => {
  it.each(READS)('a read that %s is answered in the turn a bare await of it would be', async (_how, answer) => {
    const stamps: string[][] = [];
    for (const recovery of ['bare', 'real'] as const) {
      const journal = createTurnJournal();
      const read = deferred<unknown>();
      stored.readStoredDraftState.mockImplementation(() => read.promise);
      const answered =
        recovery === 'bare'
          ? bareRecovery(() => read.promise)
          : recoverLostCommit(draftWith('2'), draftWith('3'), []);
      void answered.then(() => journal.note('answered'));
      await journal.turns(2);
      answer(read);
      await journal.turns(6);
      stamps.push(journal.lines);
    }
    const [bare, real] = stamps;
    expect(bare).toHaveLength(1);
    expect(real).toEqual(bare);
  });
});
