import { describe, expect, it, vi } from 'vitest';
import { createTurnJournal, deferred, type Deferred } from '@/test/turn-journal';
import { collectUnhandledRejections } from '@/test/unhandled-rejections';
import { createDraftSaveFlight } from './draft-save-flight';
import type { SaveDraft, SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

// R2: a background save that REJECTED (a callback of the builder threw) used to
// leave `running` a rejected promise for the life of the tab: no request started
// a save, every flush rejected with the old error, a leave stored nothing. The
// flight now returns to idle, and the failure is still raised where nothing
// catches it. This file replaces the characterization scenario "a background
// save that rejects leaves the flight unable to save or to flush".

vi.mock('./lost-commit', () => ({ recoverLostCommit: vi.fn(async () => null) }));

const draft = { id: 'd1' } as unknown as ProposalDraftState;
const failure = new Error('the background save rejected');

/** A flight whose background saves the test settles by hand, oldest first, with a journal of what it did. */
function heldFlight() {
  const journal = createTurnJournal();
  const held: Deferred<void>[] = [];
  const flight = createDraftSaveFlight(
    () => {
      journal.note(`persist#${held.length + 1}`);
      const step = deferred<void>();
      held.push(step);
      return step.promise;
    },
    { revision: 'r1', stored: 'snap-stored' },
  );
  const flush = (name: string): void => {
    void flight
      .flush(async () => journal.note(`${name} final step`))
      .then(
        () => journal.note(`${name} answered`),
        (cause: unknown) => journal.note(`${name} rejected ${String(cause)}`),
      );
  };
  return { flight, journal, held, flush };
}

describe('createDraftSaveFlight: a background save that rejects (R2)', () => {
  it('the same steps as the retired scenario: both flushes now run their final step and answer', async () => {
    const unhandled = collectUnhandledRejections();
    const on = heldFlight();
    on.flight.request();
    on.flush('flush#1');
    on.held[0].reject(failure);
    await on.journal.turns(4);
    on.flight.request();
    on.flush('flush#2');
    await on.journal.turns(4);
    expect(on.journal.lines).toEqual([
      '0 persist#1',
      '1 flush#1 final step',
      '3 flush#1 answered',
      '4 persist#2',
    ]);
    on.held[1].resolve();
    await on.journal.turns(4);
    expect(on.journal.lines.slice(4)).toEqual(['9 flush#2 final step', '11 flush#2 answered']);
    expect(on.flight.flushing).toBe(false);
    expect(await unhandled.stop()).toEqual([failure]);
  });

  it('the next request starts a save', async () => {
    const unhandled = collectUnhandledRejections();
    const on = heldFlight();
    on.flight.request();
    on.held[0].reject(failure);
    await on.journal.turns(2);
    on.flight.request();
    expect(on.journal.lines).toEqual(['0 persist#1', '2 persist#2']);
    await unhandled.stop();
  });

  it('a request queued behind it runs when it rejects, in the turn it would have run had the save answered', async () => {
    const unhandled = collectUnhandledRejections();
    const rejected = heldFlight();
    rejected.flight.request();
    rejected.flight.request();
    rejected.held[0].reject(failure);
    await rejected.journal.turns(3);
    const answered = heldFlight();
    answered.flight.request();
    answered.flight.request();
    answered.held[0].resolve();
    await answered.journal.turns(3);
    expect(rejected.journal.lines).toEqual(['0 persist#1', '0 persist#2']);
    expect(rejected.journal.lines).toEqual(answered.journal.lines);
    await unhandled.stop();
  });

  it('a leave store behind it is still sent', async () => {
    const unhandled = collectUnhandledRejections();
    const on = heldFlight();
    const save = vi.fn<SaveDraft>(async (): Promise<SaveDraftResult> => ({ ok: true }));
    on.flight.request();
    on.flight.storeOnLeave(save, draft, 'snap-edited');
    on.held[0].reject(failure);
    await on.journal.turns(4);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(draft, 'r1');
    await unhandled.stop();
  });

  it('the failure is not swallowed: it is raised once, as the very error, where nothing catches it', async () => {
    const unhandled = collectUnhandledRejections();
    const on = heldFlight();
    on.flight.request();
    on.held[0].reject(failure);
    const reasons = await unhandled.stop();
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBe(failure);
  });

  it('a background save that answers raises nothing', async () => {
    const unhandled = collectUnhandledRejections();
    const on = heldFlight();
    on.flight.request();
    on.held[0].resolve();
    expect(await unhandled.stop()).toEqual([]);
  });
});
