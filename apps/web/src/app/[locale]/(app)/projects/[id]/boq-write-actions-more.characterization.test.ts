import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoqDetail } from '@/lib/boqs/queries';
import type { EditableLine } from './boq-sheet-columns';
import { saveLine, type WriteContext } from './boq-write-actions';
import { WRITE_DEADLINE_MS, createCellWriteLatch } from './cell-write-latch';

// Two things `saveLine` does that its first characterization left unpinned.
// Both were true of the code before its two callbacks were named, and both
// are green on that code and on the split.
//
// 1. The line is read WHEN IT IS USED, not when the save is asked for: the
//    answer of a request acts on the id the line has by then.
// 2. What reports a missed deadline runs INSIDE the latch's timer, as a plain
//    call: if it throws, the throw leaves the timer. An `async` reporter would
//    swallow it into a rejection nobody handles.
//
// Every `saveLine(...)` call passes an array literal of one column, as
// cell-write-latch-call-sites.test.ts requires of test files too.

const server = vi.hoisted(() => ({
  updateBoqLine: (_input: unknown): unknown => undefined,
  toast: (_raised: unknown): void => undefined,
}));
vi.mock('@/lib/boqs/actions', () => ({
  updateBoqLine: (input: unknown) => server.updateBoqLine(input),
  addBoqLine: vi.fn(),
  addBoqSection: vi.fn(),
  deleteBoqLine: vi.fn(),
  setBoqDiscount: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ toast: (raised: unknown) => server.toast(raised) }));

function sheet() {
  const cleared: string[] = [];
  const marked: Array<[string, boolean]> = [];
  const answers: Array<(answer: unknown) => void> = [];
  server.updateBoqLine = () => new Promise((resolve) => answers.push(resolve));
  server.toast = () => undefined;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const context: WriteContext = {
    boq: { id: 'boq-1' } as BoqDetail,
    edits: {
      cells: {},
      savingIds: new Set<string>(),
      savingCount: 0,
      discount: null,
      setCell: () => undefined,
      clearColumns: () => undefined,
      setDiscount: () => undefined,
      clearSaved: (lineId) => void cleared.push(lineId),
      markSaving: (lineId, on) => void marked.push([lineId, on]),
    },
    cellErrors: { show: () => false },
    start: (transition) => void transition(),
    latch: createCellWriteLatch(),
    sheetText: (key) => key,
    errorText: (key) => key,
  };
  return { context, cleared, marked, answers };
}

async function turns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saveLine, what the first characterization left unpinned', () => {
  it('W-M1: an answer acts on the id the line has when the answer arrives', async () => {
    const { context, cleared, marked, answers } = sheet();
    const line = { id: 'line-1' } as EditableLine;

    saveLine(context, line, { qty: '12' }, ['qty']);
    line.id = 'line-9';
    answers[0]?.({ ok: true });
    await turns(10);

    expect(cleared).toEqual(['line-9']);
    expect(marked).toEqual([
      ['line-1', true],
      ['line-9', false],
    ]);
  });

  it('W-M2: a deadline report that throws leaves the timer as a throw', () => {
    vi.useFakeTimers();
    const { context } = sheet();
    server.toast = () => {
      throw new Error('toast broke');
    };

    saveLine(context, { id: 'line-1' } as EditableLine, { qty: '1' }, ['qty']);

    expect(() => vi.advanceTimersByTime(WRITE_DEADLINE_MS)).toThrow('toast broke');
  });
});
