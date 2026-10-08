import { describe, expect, it, vi } from 'vitest';
import { createDraftSaveFlight } from './draft-save-flight';
import type { SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

vi.mock('./lost-commit', () => ({ recoverLostCommit: vi.fn(async () => null) }));

/** A persist whose saves the test settles by hand, one at a time. */
function heldPersist() {
  const settlers: Array<() => void> = [];
  const persist = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        settlers.push(resolve);
      }),
  );
  const settleNext = async () => {
    settlers.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { persist, settleNext };
}

const draft = { id: 'p-1', sections: [] } as unknown as ProposalDraftState;

describe('createDraftSaveFlight', () => {
  it('two requests during a running save queue exactly one follow-up save', async () => {
    const { persist, settleNext } = heldPersist();
    const flight = createDraftSaveFlight(persist, { revision: 'r1', stored: '' });
    flight.request();
    flight.request();
    flight.request();
    expect(persist).toHaveBeenCalledTimes(1);
    await settleNext();
    expect(persist).toHaveBeenCalledTimes(2);
    await settleNext();
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('a request while nothing needs saving starts no save', () => {
    const persist = vi.fn(() => null);
    const flight = createDraftSaveFlight(persist, { revision: 'r1', stored: '' });
    flight.request();
    flight.request();
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('flush waits for the running save, drops the queued one, and resolves after its own step', async () => {
    const { persist, settleNext } = heldPersist();
    const flight = createDraftSaveFlight(persist, { revision: 'r1', stored: '' });
    const order: string[] = [];
    flight.request();
    flight.request();
    const finalStep = vi.fn(async () => {
      order.push('final');
      return 'flushed';
    });
    let flushed = false;
    const flushing = flight.flush(finalStep).then((value) => {
      flushed = true;
      return value;
    });
    flight.request();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finalStep).not.toHaveBeenCalled();
    expect(flushed).toBe(false);
    order.push('settled');
    await settleNext();
    await expect(flushing).resolves.toBe('flushed');
    expect(order).toEqual(['settled', 'final']);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(flight.flushing).toBe(false);
  });

  it('remembers a send with no answer and sends the revision it holds', async () => {
    const save = vi.fn(async (): Promise<SaveDraftResult> => {
      throw new Error('network');
    });
    const flight = createDraftSaveFlight(() => null, { revision: 'r7', stored: '' });
    const { result } = await flight.send(save, draft, 'snap', () => undefined);
    expect(result).toEqual({ ok: false, error: 'generic' });
    expect(save).toHaveBeenCalledWith(draft, 'r7');
  });

  it('caps the debounce at the max wait from the first unsaved change', () => {
    const flight = createDraftSaveFlight(() => null, { revision: 'r1', stored: '' });
    expect(flight.delayUntilSave(1_000, 1_500, 10_000)).toBe(1_500);
    expect(flight.delayUntilSave(10_000, 1_500, 10_000)).toBe(1_000);
    expect(flight.delayUntilSave(12_000, 1_500, 10_000)).toBe(0);
    flight.clearDirty();
    expect(flight.delayUntilSave(12_000, 1_500, 10_000)).toBe(1_500);
  });

  it('a leave store skips what is stored, and what a flush or send carries', async () => {
    const save = vi.fn(async (): Promise<SaveDraftResult> => ({ ok: true }));
    const flight = createDraftSaveFlight(() => null, { revision: 'r1', stored: 'stored' });
    flight.storeOnLeave(save, draft, 'stored');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(save).not.toHaveBeenCalled();
    flight.storeOnLeave(save, draft, 'edited');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(save).toHaveBeenCalledWith(draft, 'r1');
  });
});
