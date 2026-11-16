import { describe, expect, it, vi } from 'vitest';
import { createDraftSaveFlight } from './draft-save-flight';
import type { SaveDraft, SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

// What the flight hands the recovery: every send since the last confirmed save
// that never had an answer, the newest as `latest`, the rest newest first.

const lostCommit = vi.hoisted(() => ({
  recover: (..._drafts: unknown[]): Promise<unknown> => Promise.resolve(null),
}));
vi.mock('./lost-commit', () => ({
  recoverLostCommit: (...drafts: unknown[]) => lostCommit.recover(...drafts),
}));

const STALE: SaveDraftResult = { ok: false, error: 'draft_changed_elsewhere' };
const UNCERTAIN: SaveDraftResult = { ok: false, error: 'uncertain' };
const OK: SaveDraftResult = { ok: true };
const draftNamed = (name: string) => ({ id: name }) as unknown as ProposalDraftState;
const names = (drafts: unknown) => (drafts as ProposalDraftState[]).map((draft) => draft.id).join(' ');

/** A flight whose saves answer what `answers` lists, in order (then ok), and whose reads answer `reads` (then null). */
function scriptedFlight(answers: SaveDraftResult[], reads: unknown[] = []) {
  const save = vi.fn<SaveDraft>(async () => answers.shift() ?? OK);
  const recover = vi.fn(async (..._drafts: unknown[]): Promise<unknown> => reads.shift() ?? null);
  lostCommit.recover = recover;
  const flight = createDraftSaveFlight(() => null, { revision: 'r1', stored: 'snap-stored' });
  const send = (draft: ProposalDraftState) => flight.send(save, draft, `snap-${draft.id}`, () => undefined);
  /** What the n-th read was handed: `latest current | earlier...`. */
  const handed = (n: number) => {
    const [latest, current, earlier] = recover.mock.calls[n] ?? [];
    return `${names([latest, current])} | ${names(earlier)}`;
  };
  return { send, save, recover, handed };
}

describe('createDraftSaveFlight: every unconfirmed send is remembered', () => {
  it('two lost sends, then a stale refusal: the read is handed the newest, the current draft, and the earlier one', async () => {
    const { send, recover, handed } = scriptedFlight([UNCERTAIN, UNCERTAIN, STALE]);
    for (const name of ['a', 'b', 'c']) await send(draftNamed(name));
    expect(recover).toHaveBeenCalledTimes(1);
    expect(handed(0)).toBe('b c | a');
  });

  it('an ok save empties the list: a stale refusal after it reads nothing', async () => {
    const { send, recover } = scriptedFlight([UNCERTAIN, UNCERTAIN, OK, STALE]);
    for (const name of ['a', 'b', 'c', 'd']) await send(draftNamed(name));
    expect(recover).not.toHaveBeenCalled();
  });

  it('a recovery empties the list: only the save sent again after it can be unconfirmed', async () => {
    const rekeyed = draftNamed('c+ids');
    const { send, handed } = scriptedFlight(
      [UNCERTAIN, UNCERTAIN, STALE, UNCERTAIN, STALE],
      [{ revision: 'r2', idsByKey: new Map(), draft: rekeyed }],
    );
    for (const name of ['a', 'b', 'c', 'd']) await send(draftNamed(name));
    expect(handed(1)).toBe('c+ids d | ');
  });

  it('a draft sent again (Retry) is handed over once', async () => {
    const { send, handed } = scriptedFlight([UNCERTAIN, UNCERTAIN, UNCERTAIN, STALE]);
    const retried = draftNamed('a');
    await send(retried);
    await send(draftNamed('b'));
    await send(retried);
    await send(draftNamed('c'));
    expect(handed(0)).toBe('a c | b');
  });

  it('another draft object sent as the same snapshot (Retry after a render) is handed over once, the newer object', async () => {
    const { save, recover, handed } = scriptedFlight([UNCERTAIN, UNCERTAIN, UNCERTAIN, UNCERTAIN, STALE]);
    const flight = createDraftSaveFlight(() => null, { revision: 'r1', stored: 'snap-stored' });
    const sendAs = (name: string, snapshot: string) => flight.send(save, draftNamed(name), snapshot, () => undefined);
    await sendAs('a', 'snap-a');
    await sendAs('b', 'snap-b');
    await sendAs('b retry 1', 'snap-b');
    await sendAs('b retry 2', 'snap-b');
    await sendAs('c', 'snap-c');
    expect(recover).toHaveBeenCalledTimes(1);
    expect(handed(0)).toBe('b retry 2 c | a');
  });

  it('the send again after a recovery is remembered under the snapshot it was asked as', async () => {
    const rekeyed = draftNamed('b+ids');
    const { save, handed } = scriptedFlight(
      [UNCERTAIN, STALE, UNCERTAIN, UNCERTAIN, STALE],
      [{ revision: 'r2', idsByKey: new Map(), draft: rekeyed }],
    );
    const flight = createDraftSaveFlight(() => null, { revision: 'r1', stored: 'snap-stored' });
    const sendAs = (name: string, snapshot: string) => flight.send(save, draftNamed(name), snapshot, () => undefined);
    await sendAs('a', 'snap-a');
    await sendAs('b', 'snap-b');
    await sendAs('b retry', 'snap-b');
    await sendAs('c', 'snap-c');
    expect(handed(1)).toBe('b retry c | ');
  });

  it('a recovery has emptied the list before it hands the ids on: a throw there does not bring the sends back', async () => {
    const { save, recover } = scriptedFlight(
      [UNCERTAIN, STALE, STALE],
      [{ revision: 'r2', idsByKey: new Map(), draft: draftNamed('b+ids') }],
    );
    const flight = createDraftSaveFlight(() => null, { revision: 'r1', stored: 'snap-stored' });
    await flight.send(save, draftNamed('a'), 'snap-a', () => undefined);
    const refused = flight.send(save, draftNamed('b'), 'snap-b', () => {
      throw new Error('the ids could not be adopted');
    });
    await expect(refused).rejects.toThrow('the ids could not be adopted');
    expect(flight.revision).toBe('r2');
    await flight.send(save, draftNamed('c'), 'snap-c', () => undefined);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('after ten lost sends the read is handed eight: the first and the newest seven', async () => {
    const { send, handed } = scriptedFlight([...Array.from({ length: 10 }, () => UNCERTAIN), STALE]);
    for (let n = 1; n <= 11; n += 1) await send(draftNamed(`d${n}`));
    expect(handed(0)).toBe('d10 d11 | d9 d8 d7 d6 d5 d4 d1');
  });

  it('a real conflict forgets nothing: the next refusal is handed the same sends', async () => {
    const { send, handed } = scriptedFlight([UNCERTAIN, UNCERTAIN, STALE, STALE]);
    for (const name of ['a', 'b', 'c', 'd']) await send(draftNamed(name));
    expect(handed(1)).toBe('b d | a');
  });
});
