import { describe, expect, it, vi } from 'vitest';
import { createDraftSaveFlight } from './draft-save-flight';
import type { SaveDraft, SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

// A stale refusal while an earlier send is unconfirmed, and the stored draft
// cannot be read: whose commit is stored is still unknown. The flight used to
// answer the refusal ("changed in another tab, reload"), which is false then.

const lostCommit = vi.hoisted(() => ({
  recover: (..._drafts: unknown[]): Promise<unknown> => Promise.resolve(null),
}));
vi.mock('./lost-commit', () => ({
  recoverLostCommit: (...drafts: unknown[]) => lostCommit.recover(...drafts),
}));

const STALE: SaveDraftResult = { ok: false, error: 'draft_changed_elsewhere' };
const UNCERTAIN: SaveDraftResult = { ok: false, error: 'uncertain' };
const draftNamed = (name: string) => ({ id: name }) as unknown as ProposalDraftState;

/** A flight whose saves answer what `answers` lists, in order, and whose reads of the stored draft answer `reads`. */
function scriptedFlight(answers: SaveDraftResult[], reads: unknown[]) {
  const save = vi.fn<SaveDraft>(async () => answers.shift() ?? { ok: true });
  const recover = vi.fn(async (..._drafts: unknown[]): Promise<unknown> => reads.shift() ?? null);
  lostCommit.recover = recover;
  const onRecovered = vi.fn();
  const flight = createDraftSaveFlight(() => null, { revision: 'r1', stored: 'snap-stored' });
  const send = (draft: ProposalDraftState) => flight.send(save, draft, `snap-${draft.id}`, onRecovered);
  return { flight, save, recover, onRecovered, send };
}

describe('createDraftSaveFlight: the stored draft cannot be read', () => {
  it('the send answers uncertain, not the stale refusal, with the draft it sent', async () => {
    const { send, save, onRecovered, flight } = scriptedFlight([UNCERTAIN, STALE], ['unreadable']);
    const second = draftNamed('b');
    await send(draftNamed('a'));
    const answer = await send(second);
    expect(answer.result).toEqual(UNCERTAIN);
    expect(answer.sent).toBe(second);
    expect(save).toHaveBeenCalledTimes(2);
    expect(onRecovered).not.toHaveBeenCalled();
    expect(flight.revision).toBe('r1');
  });

  it('nothing is forgotten and the refused draft is not remembered: the next refusal reads again, for the same lost send', async () => {
    const { send, recover } = scriptedFlight([UNCERTAIN, STALE, STALE], ['unreadable', 'unreadable']);
    const lost = draftNamed('a');
    const third = draftNamed('c');
    await send(lost);
    await send(draftNamed('b'));
    expect((await send(third)).result).toEqual(UNCERTAIN);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(recover.mock.calls[1]?.[0]).toBe(lost);
    expect(recover.mock.calls[1]?.[1]).toBe(third);
  });

  it('a retry whose read succeeds recovers: the revision is adopted and the re-keyed draft is sent once', async () => {
    const rekeyed = draftNamed('b+ids');
    const ids = new Map([['key', 'id']]);
    const { send, save, onRecovered, flight } = scriptedFlight(
      [UNCERTAIN, STALE, STALE, { ok: true }],
      ['unreadable', { revision: 'r2', idsByKey: ids, draft: rekeyed }],
    );
    const retried = draftNamed('b');
    await send(draftNamed('a'));
    await send(retried);
    const answer = await send(retried);
    expect(answer).toEqual({ result: { ok: true }, sent: rekeyed });
    expect(onRecovered).toHaveBeenCalledWith(ids);
    expect(flight.revision).toBe('r2');
    expect(save).toHaveBeenCalledTimes(4);
    expect(save).toHaveBeenLastCalledWith(rekeyed, 'r2');
  });

  it('a read that answers null is still a real conflict: the stale refusal itself, as before', async () => {
    const { send } = scriptedFlight([UNCERTAIN, STALE], [null]);
    await send(draftNamed('a'));
    expect((await send(draftNamed('b'))).result).toBe(STALE);
  });
});
