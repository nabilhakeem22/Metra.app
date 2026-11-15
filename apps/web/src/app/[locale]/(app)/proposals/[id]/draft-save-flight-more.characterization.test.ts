import { describe, expect, it, vi } from 'vitest';
import { createDraftSaveFlight } from './draft-save-flight';
import type { RecoveredCommit } from './lost-commit';
import type { SaveDraft, SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

// One thing the first characterization of the flight compared by content only:
// after a lost commit is recovered, the recovered draft and its ids are handed
// on AS THEMSELVES, never as copies. True of the code before the recovering
// send became its own factory; green on that code and on the split.

const lostCommit = vi.hoisted(() => ({
  recover: (_unconfirmed: unknown, _current: unknown): unknown => null,
}));
vi.mock('./lost-commit', () => ({
  recoverLostCommit: (unconfirmed: unknown, current: unknown) => lostCommit.recover(unconfirmed, current),
}));

const draftNamed = (name: string) => ({ name }) as unknown as ProposalDraftState;

describe('createDraftSaveFlight, what the first characterization left unpinned', () => {
  it('F-M1: a recovery sends the recovered draft itself and hands on its ids map itself', async () => {
    const recovered = {
      revision: 'r2',
      draft: draftNamed('recovered'),
      idsByKey: new Map([['key', 'id']]),
    } as unknown as RecoveredCommit;
    lostCommit.recover = async () => recovered;

    const answers = [
      { ok: false, error: 'uncertain' },
      { ok: false, error: 'draft_changed_elsewhere' },
      { ok: true },
    ] as unknown as SaveDraftResult[];
    const sent: Array<[ProposalDraftState, string]> = [];
    const save: SaveDraft = async (draft, revision) => {
      sent.push([draft, revision]);
      return answers[sent.length - 1] as SaveDraftResult;
    };
    const flight = createDraftSaveFlight(() => null, { revision: 'r1', stored: 'stored' });
    const adopted: unknown[] = [];

    await flight.send(save, draftNamed('first'), 'a', () => undefined);
    const answer = await flight.send(save, draftNamed('second'), 'b', (idsByKey) => void adopted.push(idsByKey));

    expect(sent).toHaveLength(3);
    expect(sent[2]?.[0]).toBe(recovered.draft);
    expect(sent[2]?.[1]).toBe('r2');
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toBe(recovered.idsByKey);
    expect(answer.sent).toBe(recovered.draft);
    expect(flight.revision).toBe('r2');
  });
});
