import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqDetail } from '@/lib/boqs/queries';
import type { Column, EditableLine } from './boq-sheet-columns';
import { saveLine, type WriteContext } from './boq-write-actions';
import { createCellWriteLatch } from './cell-write-latch';

// `@/lib/boqs/actions` is 'use server' and reaches the whole server-only stack.
const actions = vi.hoisted(() => ({
  updateBoqLine: vi.fn(),
  addBoqLine: vi.fn(),
  addBoqSection: vi.fn(),
  deleteBoqLine: vi.fn(),
  setBoqDiscount: vi.fn(),
}));
vi.mock('@/lib/boqs/actions', () => actions);

interface RaisedToast {
  title?: string;
  variant?: string;
}
const toasts = vi.hoisted(() => [] as RaisedToast[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: RaisedToast) => {
    toasts.push(raised);
  },
}));

/**
 * The saving light, as data. `markSaving` is COUNTED in the real
 * `useBoqEdits` (W5 R6) and the assertions below are about that count, so the
 * fake counts too rather than pretending a Set is good enough.
 */
function fakeEdits() {
  const inFlight = new Map<string, number>();
  const cleared: { lineId: string; columns: Column[] }[] = [];
  return {
    inFlight,
    cleared,
    api: {
      cells: {},
      savingIds: new Set<string>(),
      savingCount: 0,
      setCell: vi.fn(),
      clearColumns: (lineId: string, columns: Column[]) => {
        cleared.push({ lineId, columns });
      },
      markSaving: (lineId: string, on: boolean) => {
        const next = (inFlight.get(lineId) ?? 0) + (on ? 1 : -1);
        if (next > 0) inFlight.set(lineId, next);
        else inFlight.delete(lineId);
      },
      discount: null,
      setDiscount: vi.fn(),
    },
  };
}

/** A context plus the promises `start` was handed, so a test can await them. */
function harness() {
  const edits = fakeEdits();
  const started: Promise<unknown>[] = [];
  const context: WriteContext = {
    boq: { id: 'boq-1' } as BoqDetail,
    edits: edits.api,
    start: (callback) => {
      started.push(Promise.resolve(callback() as unknown));
    },
    latch: createCellWriteLatch(),
    sheetText: (key) => `sheet.${key}`,
    errorText: (key) => `errors.${key}`,
  };
  return { context, edits, settle: () => Promise.all(started) };
}

const LINE = { id: 'line-1' } as EditableLine;

beforeEach(() => {
  actions.updateBoqLine.mockReset();
  actions.updateBoqLine.mockResolvedValue({ ok: true });
  toasts.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saveLine', () => {
  it('holds the second write of a cell until the first has answered (W5 R5)', async () => {
    // Both writes used to go out together and the LAST ARRIVAL won, which is not
    // the same as the last value the studio typed.
    const { context, settle } = harness();
    let releaseFirst!: (value: { ok: boolean }) => void;
    actions.updateBoqLine
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true });

    saveLine(context, LINE, { qty: '12' }, ['qty']);
    saveLine(context, LINE, { qty: '15' }, ['qty']);
    await Promise.resolve();

    expect(actions.updateBoqLine).toHaveBeenCalledTimes(1);
    expect(actions.updateBoqLine.mock.calls[0]![0]).toEqual({
      lineId: 'line-1',
      patch: { qty: '12' },
    });

    releaseFirst({ ok: true });
    await settle();

    expect(actions.updateBoqLine).toHaveBeenCalledTimes(2);
    // The order the studio typed them in, which is the point.
    expect(actions.updateBoqLine.mock.calls[1]![0]).toEqual({
      lineId: 'line-1',
      patch: { qty: '15' },
    });
  });

  it('keeps the row marked saving until BOTH writes have finished (W5 R6)', async () => {
    const { context, edits, settle } = harness();
    let releaseFirst!: (value: { ok: boolean }) => void;
    actions.updateBoqLine
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true });

    saveLine(context, LINE, { qty: '12' }, ['qty']);
    saveLine(context, LINE, { qty: '15' }, ['qty']);
    // Marked SYNCHRONOUSLY, both of them: a write merely waiting its turn is a
    // write that has not happened, and the footer must not say otherwise.
    expect(edits.inFlight.get('line-1')).toBe(2);

    // Let the first write actually start before releasing it.
    await Promise.resolve();
    releaseFirst({ ok: true });
    await settle();
    expect(edits.inFlight.has('line-1')).toBe(false);
  });

  it('writes to DIFFERENT columns of one line still go together', async () => {
    const { context, settle } = harness();
    actions.updateBoqLine.mockImplementation(() => new Promise(() => undefined));

    saveLine(context, LINE, { qty: '12' }, ['qty']);
    saveLine(context, LINE, { unitPrice: '99' }, ['unitPrice']);
    await Promise.resolve();

    expect(actions.updateBoqLine).toHaveBeenCalledTimes(2);
    void settle;
  });

  it('clears the local edit on ok and leaves it on a coded refusal', async () => {
    const { context, edits, settle } = harness();
    actions.updateBoqLine.mockResolvedValueOnce({ ok: false, error: 'invalid_qty' });

    saveLine(context, LINE, { qty: 'x' }, ['qty']);
    await settle();

    expect(edits.cleared).toEqual([]);
    expect(toasts).toEqual([{ title: 'errors.invalid_qty', variant: 'destructive' }]);
  });

  it('LOGS a save that rejected, as well as toasting it (W5 R8)', async () => {
    // A rejection left no trace anywhere: `mutateInOrg` never saw it, so the
    // server has nothing, and the toast is gone in five seconds. The engagement
    // page has logged its twin since wave 5; the sheet did not.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { context, settle } = harness();
    actions.updateBoqLine.mockRejectedValueOnce(new Error('offline'));

    saveLine(context, LINE, { qty: '12' }, ['qty']);
    await settle();

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0]![0]).toBe('boq line save failed before returning a result');
    expect(toasts).toEqual([{ title: 'sheet.saveFailed', variant: 'destructive' }]);
  });

  it('a rejected save does not strand the next edit of the same cell', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { context, edits, settle } = harness();
    actions.updateBoqLine
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true });

    saveLine(context, LINE, { qty: '12' }, ['qty']);
    saveLine(context, LINE, { qty: '15' }, ['qty']);
    await settle();

    expect(actions.updateBoqLine).toHaveBeenCalledTimes(2);
    expect(edits.cleared).toEqual([{ lineId: 'line-1', columns: ['qty'] }]);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
