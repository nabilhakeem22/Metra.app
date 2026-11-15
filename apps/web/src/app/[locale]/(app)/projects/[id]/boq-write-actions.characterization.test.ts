import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqDetail } from '@/lib/boqs/queries';
import { digestOf, seededPicker } from '@/test/golden-cases';
import { createTurnJournal, deferred, ordersOf, type Deferred } from '@/test/turn-journal';
import type { EditableLine } from './boq-sheet-columns';
import { saveLine, type WriteContext } from './boq-write-actions';
import {
  WRITE_DEADLINE_MS,
  createCellWriteLatch,
  type CellWrite,
  type CellWriteLatch,
} from './cell-write-latch';
import recordedDigests from './boq-write-actions.golden-digests.json';
import recordedJournals from './boq-write-actions.golden-journals.json';

// CHARACTERIZATION of `saveLine`, recorded from the code as it stood BEFORE it
// was split, and never edited afterwards. What is pinned is the ORDER and the
// TIMING of everything a save does: each line of a journal is one call the save
// made (the server action, the saving light, the cleared edit, the cell error,
// the toast, the log) stamped with the microtask turns passed since the story
// began, so one more `await`, or an `async` wrapper around the request, moves a
// line and reds a journal. The latch is the real one, on fake timers.
//
// EVERY `saveLine(...)` CALL BELOW PASSES AN ARRAY LITERAL OF AT MOST ONE COLUMN.
// cell-write-latch-call-sites.test.ts scans test files too and reds on anything
// else, a forwarded variable included. That is why the steps are a table of
// literal calls and not one call with a column variable.

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

const LINE_1 = { id: 'line-1' } as EditableLine;
const LINE_2 = { id: 'line-2' } as EditableLine;
const CELL_COLUMNS = ['itemCode', 'description', 'unit', 'qty', 'unitPrice'];

const ANSWERS = {
  ok: { ok: true },
  refused: { ok: false, error: 'boq_not_draft' },
  cells: { ok: false, error: 'check_fields', fields: { qty: { code: 'invalid_qty' } } },
  cellsElsewhere: {
    ok: false,
    error: 'check_fields',
    fields: { qty: { code: 'invalid_qty' }, discountPct: { code: 'invalid_percent' } },
  },
  generic: { ok: false, error: 'generic', reference: 'ref-7' },
};
const REJECTIONS = {
  reject: () => new Error('offline'),
  unreachable: () => new TypeError('fetch failed'),
  digest: () => Object.assign(new Error('the server threw'), { digest: 'dg-1' }),
};

/** One sheet: the doubles a save talks to, all writing into one journal. */
function sheet(options: { held?: boolean; latch?: CellWriteLatch } = {}) {
  const journal = createTurnJournal();
  /** The `updateBoqLine` calls not yet answered, oldest first. */
  const unanswered: Deferred<unknown>[] = [];
  /** The transitions `start` was handed and has not run yet (held mode), oldest first. */
  const heldTransitions: Array<() => void> = [];
  const flags = { nextCallThrows: false };
  let calls = 0;
  let transitions = 0;
  server.updateBoqLine = (input) => {
    calls += 1;
    journal.note(`updateBoqLine#${calls} ${JSON.stringify(input)}`);
    if (flags.nextCallThrows) {
      flags.nextCallThrows = false;
      throw new Error('threw before sending');
    }
    const gate = deferred<unknown>();
    unanswered.push(gate);
    return gate.promise;
  };
  server.toast = (raised) => journal.note(`toast ${JSON.stringify(raised)}`);
  vi.spyOn(console, 'error').mockImplementation((...logged: unknown[]) => {
    journal.note(`console.error ${JSON.stringify(logged)}`);
  });
  const editsNamed = (name: string): WriteContext['edits'] => ({
    cells: {},
    savingIds: new Set<string>(),
    savingCount: 0,
    discount: null,
    setCell: () => journal.note(`${name}.setCell`),
    clearColumns: () => journal.note(`${name}.clearColumns`),
    setDiscount: () => journal.note(`${name}.setDiscount`),
    clearSaved: (lineId, saved) => journal.note(`${name}.clearSaved ${lineId} ${JSON.stringify(saved)}`),
    markSaving: (lineId, on) => journal.note(`${name}.markSaving ${lineId} ${String(on)}`),
  });
  const context: WriteContext = {
    boq: { id: 'boq-1' } as BoqDetail,
    edits: editsNamed('edits'),
    cellErrors: {
      // As the real one answers: whether every refused field had a cell.
      show: (lineId, fields) => {
        const allHadCells = Object.keys(fields).every((field) => CELL_COLUMNS.includes(field));
        journal.note(`show ${lineId} ${JSON.stringify(fields)} -> ${String(allHadCells)}`);
        return allHadCells;
      },
    },
    start: (transition) => {
      transitions += 1;
      const name = `transition#${transitions}`;
      journal.note(`start ${name}`);
      const run = () => {
        void Promise.resolve(transition()).then(
          () => journal.note(`${name} settled`),
          (cause: unknown) => journal.note(`${name} rejected ${String(cause)}`),
        );
      };
      if (options.held) heldTransitions.push(run);
      else run();
    },
    latch: options.latch ?? createCellWriteLatch(),
    sheetText: (key) => `sheet.${key}`,
    errorText: (key, values) => (values ? `errors.${key} ${JSON.stringify(values)}` : `errors.${key}`),
  };
  return { journal, context, unanswered, heldTransitions, flags, editsNamed };
}
type Sheet = ReturnType<typeof sheet>;

/** What a story is made of. Each `saveLine` call is written out: see the header. */
const STEPS = {
  q12: (on: Sheet) => saveLine(on.context, LINE_1, { qty: '12' }, ['qty']),
  q15: (on: Sheet) => saveLine(on.context, LINE_1, { qty: '15' }, ['qty']),
  q18: (on: Sheet) => saveLine(on.context, LINE_1, { qty: '18' }, ['qty']),
  price: (on: Sheet) => saveLine(on.context, LINE_1, { unitPrice: '99.5' }, ['unitPrice']),
  toggle: (on: Sheet) => saveLine(on.context, LINE_1, { provisional: true }, []),
  other: (on: Sheet) => saveLine(on.context, LINE_2, { qty: '7' }, ['qty']),
  /** Run the oldest transition `start` is holding (held mode only). */
  begin: (on: Sheet) => on.heldTransitions.shift()?.(),
  ok: (on: Sheet) => on.unanswered.shift()?.resolve(ANSWERS.ok),
  /** Answer the NEWEST call first: two cells of one line are on the wire together. */
  okNewest: (on: Sheet) => on.unanswered.pop()?.resolve(ANSWERS.ok),
  refused: (on: Sheet) => on.unanswered.shift()?.resolve(ANSWERS.refused),
  cells: (on: Sheet) => on.unanswered.shift()?.resolve(ANSWERS.cells),
  cellsElsewhere: (on: Sheet) => on.unanswered.shift()?.resolve(ANSWERS.cellsElsewhere),
  generic: (on: Sheet) => on.unanswered.shift()?.resolve(ANSWERS.generic),
  reject: (on: Sheet) => on.unanswered.shift()?.reject(REJECTIONS.reject()),
  unreachable: (on: Sheet) => on.unanswered.shift()?.reject(REJECTIONS.unreachable()),
  digest: (on: Sheet) => on.unanswered.shift()?.reject(REJECTIONS.digest()),
  /** The next `updateBoqLine` call throws instead of returning a promise. */
  throwNext: (on: Sheet) => {
    on.flags.nextCallThrows = true;
  },
  turn: (on: Sheet) => on.journal.turns(1),
  almost: () => {
    vi.advanceTimersByTime(WRITE_DEADLINE_MS - 1);
  },
  tick: () => {
    vi.advanceTimersByTime(1);
  },
  deadline: () => {
    vi.advanceTimersByTime(WRITE_DEADLINE_MS);
  },
} satisfies Record<string, (on: Sheet) => unknown>;
type Step = keyof typeof STEPS;

interface Story {
  steps: readonly Step[];
  /** `start` keeps each transition until a `begin` step runs it. */
  held?: boolean;
  /** Turns let pass after every step. */
  gap?: number;
}

/**
 * Tell one story and answer its journal. After the last step the story is
 * finished off, six turns at a time: run a held transition, else answer the
 * oldest call `ok`, else let the deadline pass, until nothing is left.
 */
async function journalOf(story: Story): Promise<string[]> {
  vi.clearAllTimers();
  const on = sheet({ held: story.held });
  for (const step of story.steps) {
    on.journal.note(`> ${step}`);
    const waiting = STEPS[step](on);
    if (waiting instanceof Promise) await waiting;
    if (story.gap) await on.journal.turns(story.gap);
  }
  for (let round = 0; round < 60; round += 1) {
    await on.journal.turns(6);
    if (on.heldTransitions.length > 0) {
      on.journal.note('> (begin)');
      STEPS.begin(on);
    } else if (on.unanswered.length > 0) {
      on.journal.note('> (ok)');
      STEPS.ok(on);
    } else if (vi.getTimerCount() > 0) {
      on.journal.note('> (deadline)');
      STEPS.deadline();
    } else break;
  }
  on.journal.note(`end timers=${vi.getTimerCount()}`);
  return on.journal.lines;
}

/** The stories a person reads: each has its whole journal in the golden-journals file. */
const NAMED: Record<string, Story> = {
  'one save, answered ok': { steps: ['q12', 'turn', 'ok'] },
  'a coded refusal that names no cell': { steps: ['q12', 'refused'] },
  'a refusal that names its cell': { steps: ['q12', 'cells'] },
  'a refusal that names a field with no cell': { steps: ['q12', 'cellsElsewhere'] },
  'an unknown failure with its reference': { steps: ['q12', 'generic'] },
  'a save that rejected': { steps: ['q12', 'reject'] },
  'a save that never reached the server': { steps: ['q12', 'unreachable'] },
  'a save the server threw on': { steps: ['q12', 'digest'] },
  'a save that threw before it was sent': { steps: ['throwNext', 'q12'] },
  'two saves of one cell': { steps: ['q12', 'q15', 'turn', 'ok'] },
  'three saves of one cell': { steps: ['q12', 'q15', 'q18', 'turn', 'turn', 'turn', 'ok'] },
  'a rejected save does not strand the next': { steps: ['q12', 'q15', 'reject'] },
  'two cells of one line, answered newest first': { steps: ['q12', 'price', 'okNewest', 'turn', 'ok'] },
  'two toggles and a cell': { steps: ['toggle', 'q12', 'toggle', 'ok'] },
  'two lines': { steps: ['q12', 'other', 'ok', 'ok'] },
  'a save that never answers, then answers late': {
    steps: ['q12', 'q15', 'almost', 'turn', 'tick', 'turn', 'turn', 'turn', 'ok', 'ok'],
  },
  'an answer one millisecond before the deadline': { steps: ['q12', 'almost', 'ok', 'turn', 'turn', 'turn', 'tick'] },
  'a held transition': { steps: ['q12', 'q15', 'begin', 'turn', 'begin', 'ok'], held: true },
};

/** The grid: two sets of five steps in every order at three gaps, and 300 seeded stories. */
const ORDERED: Record<string, readonly Step[]> = {
  retyped: ['q12', 'q15', 'q18', 'ok', 'reject'],
  unanswered: ['q12', 'q15', 'deadline', 'ok', 'turn'],
};
const RANDOM_STEPS: readonly Step[] = [
  'q12', 'q15', 'q18', 'q12', 'q15', 'price', 'toggle', 'other',
  'ok', 'ok', 'ok', 'okNewest', 'refused', 'cells', 'cellsElsewhere', 'generic',
  'reject', 'unreachable', 'digest', 'throwNext',
  'turn', 'turn', 'turn', 'almost', 'tick', 'deadline', 'begin',
];

function gridStories(): Array<[string, Story]> {
  const stories: Array<[string, Story]> = [];
  for (const [name, set] of Object.entries(ORDERED)) {
    for (const gap of [0, 1, 2]) {
      for (const steps of ordersOf(set)) {
        stories.push([['orders', name, `gap${gap}`, steps.join(' ')].join('/'), { steps, gap }]);
      }
    }
  }
  const pick = seededPicker(20261201);
  for (let n = 0; n < 300; n += 1) {
    const held = pick([false, false, false, true]);
    const length = pick([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const steps = Array.from({ length }, () => pick(RANDOM_STEPS));
    stories.push([[`rand/${n}`, held ? 'held' : 'now', steps.join(' ')].join(': '), { steps, held }]);
  }
  return stories;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saveLine, story by story', () => {
  it.each(Object.keys(NAMED))('%s', async (name) => {
    expect(await journalOf(NAMED[name])).toEqual((recordedJournals as Record<string, string[]>)[name]);
  });

  it('has a recorded journal for every story, and for no other', () => {
    expect(Object.keys(recordedJournals)).toEqual(Object.keys(NAMED));
  });
});

describe('saveLine, what it hands the latch', () => {
  /** A latch that only records: the test answers each request itself. */
  function recordingLatch(note: (text: string) => void) {
    const requests: CellWrite[] = [];
    const answers: Deferred<void>[] = [];
    const latch: CellWriteLatch = {
      run(request) {
        note(`latch.run ${request.lineId} ${JSON.stringify(request.columns)}`);
        requests.push(request);
        const answer = deferred<void>();
        answers.push(answer);
        return answer.promise;
      },
    };
    return { latch, requests, answers };
  }

  it('one request per save, and the row is unmarked when the LATCH answers, not the write', async () => {
    const notes: string[] = [];
    const recording = recordingLatch((text) => notes.push(text));
    const on = sheet({ latch: recording.latch });
    STEPS.q12(on);
    expect(on.journal.lines).toEqual(['0 edits.markSaving line-1 true', '0 start transition#1']);
    expect(notes).toEqual(['latch.run line-1 ["qty"]']);
    expect(Object.keys(recording.requests[0])).toEqual(['lineId', 'columns', 'write', 'onDeadline']);

    // The deadline handler by itself: one log line and one toast, nothing else.
    recording.requests[0].onDeadline();
    // The request and the log line share ONE column list: it is handed on, not copied.
    (recording.requests[0].columns as string[]).push('seen');
    void recording.requests[0].write();
    STEPS.refused(on);
    await on.journal.turns(4);
    recording.answers[0].resolve();
    await on.journal.turns(4);
    expect(on.journal.lines.slice(2)).toEqual([
      '0 console.error ["boq line save passed its deadline with no answer",{"lineId":"line-1","columns":["qty"]}]',
      '0 toast {"title":"sheet.saveFailed","variant":"destructive"}',
      '0 updateBoqLine#1 {"lineId":"line-1","patch":{"qty":"12"}}',
      '0 console.error ["boq line save refused",{"lineId":"line-1","columns":["qty","seen"],"code":"boq_not_draft"}]',
      '0 toast {"title":"errors.boq_not_draft","variant":"destructive"}',
      '4 edits.markSaving line-1 false',
      '7 transition#1 settled',
    ]);
  });

  it('unmarks the row when the latch REJECTS, and the transition rejects with it', async () => {
    const recording = recordingLatch(() => undefined);
    const on = sheet({ latch: recording.latch });
    STEPS.q15(on);
    recording.answers[0].reject(new Error('the latch broke'));
    await on.journal.turns(4);
    expect(on.journal.lines).toEqual([
      '0 edits.markSaving line-1 true',
      '0 start transition#1',
      '0 edits.markSaving line-1 false',
      '3 transition#1 rejected Error: the latch broke',
    ]);
  });
});

describe('saveLine, what it reads and when', () => {
  it('reads the saved values when called, and the line, the patch and the context when it uses them', async () => {
    const sent: unknown[] = [];
    const on = sheet({ held: true });
    const answering = server.updateBoqLine;
    server.updateBoqLine = (input) => {
      sent.push(input);
      return answering(input);
    };
    const line = { id: 'line-1' } as EditableLine;
    const patch = { qty: '12' };
    saveLine(on.context, line, patch, ['qty']);
    // Changed after the call, before the transition runs.
    patch.qty = '13';
    line.id = 'line-9';
    on.context.edits = on.editsNamed('later');
    STEPS.begin(on);
    STEPS.ok(on);
    await on.journal.turns(6);
    expect(on.journal.lines).toEqual([
      '0 edits.markSaving line-1 true',
      '0 start transition#1',
      '0 updateBoqLine#1 {"lineId":"line-9","patch":{"qty":"13"}}',
      '0 later.clearSaved line-9 {"qty":"12"}',
      '2 later.markSaving line-9 false',
      '5 transition#1 settled',
    ]);
    expect((sent[0] as { patch: unknown }).patch).toBe(patch);
  });
});

describe('saveLine, the grid', () => {
  it('two sets of five steps in every order at three gaps, and 300 seeded stories', async () => {
    const digests: Record<string, string> = {};
    for (const [id, story] of gridStories()) digests[id] = digestOf((await journalOf(story)).join('\n'));
    expect(Object.keys(digests)).toHaveLength(1020);
    expect(digests).toEqual(recordedDigests);
  });
});
