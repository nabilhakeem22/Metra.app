import { describe, expect, it, vi } from 'vitest';
import { digestOf, seededPicker } from '@/test/golden-cases';
import { createTurnJournal, deferred, ordersOf, type Deferred } from '@/test/turn-journal';
import { createDraftSaveFlight } from './draft-save-flight';
import type { RecoveredCommit } from './lost-commit';
import type { SaveDraft, SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';
import recordedDigests from './draft-save-flight.golden-digests.json';
import recordedJournals from './draft-save-flight.golden-journals.json';

// CHARACTERIZATION of `createDraftSaveFlight`, recorded from the code as it
// stood BEFORE the recovering send was lifted out of it, and never edited
// afterwards. What is pinned is the ORDER and the TIMING of everything a flight
// does: each line of a journal is one call it made (a background save started,
// a save sent with its draft and revision, the stored draft asked for, the
// recovered ids handed on, a final step run) or one answer it gave, stamped
// with the microtask turns passed since the story began. One more `await` in
// the flight, or an `async` wrapper around a send, moves a line and reds a
// journal.

const lostCommit = vi.hoisted(() => ({
  recover: (_unconfirmed: unknown, _current: unknown): Promise<unknown> => Promise.resolve(null),
}));
vi.mock('./lost-commit', () => ({
  recoverLostCommit: (unconfirmed: unknown, current: unknown) => lostCommit.recover(unconfirmed, current),
}));

const ANSWERS = {
  ok: { ok: true },
  stale: { ok: false, error: 'draft_changed_elsewhere' },
  generic: { ok: false, error: 'generic', reference: 'ref-3' },
  uncertain: { ok: false, error: 'uncertain' },
  refused: { ok: false, error: 'draft_incomplete' },
} satisfies Record<string, SaveDraftResult>;

/** What `persist` does when the flight asks for a background save. */
type Persist = 'sends' | 'held' | 'idle';

/** One builder: a flight and the doubles it talks to, all writing into one journal. */
function builder(persistMode: Persist = 'sends') {
  const journal = createTurnJournal();
  /** Saves not yet answered, oldest first. */
  const saves: Deferred<SaveDraftResult>[] = [];
  /** Reads of the stored draft not yet answered, oldest first, each with the draft it was asked for. */
  const recoveries: Array<{ current: ProposalDraftState; answer: Deferred<RecoveredCommit | null> }> = [];
  /** Held background saves and held final steps not yet finished, oldest first. */
  const held: Array<{ kind: 'persist' | 'final'; step: Deferred<string> }> = [];
  const flags = { nextSaveThrows: false };
  const counts = { drafts: 0, saves: 0, recoveries: 0, sends: 0, flushes: 0, persists: 0, revisions: 1 };
  const latest = { draft: { id: 'd0' } as ProposalDraftState, snapshot: 'snap-d0' };
  let clock = 1_000;

  const save: SaveDraft = (draft, revision) => {
    counts.saves += 1;
    journal.note(`save#${counts.saves} ${draft.id} at ${revision}`);
    if (flags.nextSaveThrows) {
      flags.nextSaveThrows = false;
      throw new Error('threw before sending');
    }
    const answer = deferred<SaveDraftResult>();
    saves.push(answer);
    return answer.promise;
  };
  lostCommit.recover = (unconfirmed, current) => {
    counts.recoveries += 1;
    const lost = unconfirmed as ProposalDraftState;
    const now = current as ProposalDraftState;
    journal.note(`recover#${counts.recoveries} unconfirmed=${lost.id} current=${now.id}`);
    const answer = deferred<RecoveredCommit | null>();
    recoveries.push({ current: now, answer });
    return answer.promise;
  };
  const holdStep = (kind: 'persist' | 'final'): Promise<string> => {
    const step = deferred<string>();
    held.push({ kind, step });
    return step.promise;
  };
  const flight = createDraftSaveFlight(
    () => {
      counts.persists += 1;
      journal.note(`persist#${counts.persists}`);
      if (persistMode === 'idle') return null;
      return persistMode === 'sends' ? send() : holdStep('persist');
    },
    { revision: 'r1', stored: 'snap-stored' },
  );
  const newDraft = (): void => {
    counts.drafts += 1;
    latest.draft = { id: `d${counts.drafts}` } as ProposalDraftState;
    latest.snapshot = `snap-${latest.draft.id}`;
  };
  /** Send a new draft through the flight, as the autosave hook does, and note the answer. */
  function send(): Promise<void> {
    counts.sends += 1;
    const name = `send#${counts.sends}`;
    newDraft();
    return flight
      .send(save, latest.draft, latest.snapshot, (idsByKey) => {
        journal.note(`onRecovered ${JSON.stringify([...idsByKey])} revision=${flight.revision}`);
      })
      .then(
        ({ result, sent }) => journal.note(`${name} answered ${JSON.stringify(result)} sent=${sent.id}`),
        (cause: unknown) => journal.note(`${name} rejected ${String(cause)}`),
      );
  }
  const flush = (finalStep: () => Promise<unknown>): void => {
    counts.flushes += 1;
    const name = `flush#${counts.flushes}`;
    void flight
      .flush(() => {
        journal.note(`${name} final step`);
        return finalStep();
      })
      .then(
        () => journal.note(`${name} answered`),
        (cause: unknown) => journal.note(`${name} rejected ${String(cause)}`),
      );
  };
  const delay = (): void => {
    journal.note(`delayUntilSave(${clock}) = ${flight.delayUntilSave(clock, 1_500, 10_000)}`);
    clock += 4_000;
  };
  return { journal, flight, saves, recoveries, held, flags, counts, latest, save, send, flush, holdStep, newDraft, delay };
}
type Builder = ReturnType<typeof builder>;

const answerSave = (on: Builder, answer: SaveDraftResult): void => on.saves.shift()?.resolve(answer);

/** What a story is made of. */
const STEPS = {
  request: (on: Builder) => on.flight.request(),
  send: (on: Builder) => {
    void on.send();
  },
  /** A flush whose final step is held until a `finish` or `failFinal` step. */
  flush: (on: Builder) => on.flush(() => on.holdStep('final')),
  /** A flush whose final step sends the latest draft, as Send does. */
  flushSend: (on: Builder) => on.flush(() => on.send()),
  flushThrow: (on: Builder) =>
    on.flush(() => {
      throw new Error('the final step threw');
    }),
  /** Leave with the draft last sent: nothing to store while it is being sent, or once it is stored. */
  leave: (on: Builder) => on.flight.storeOnLeave(on.save, on.latest.draft, on.latest.snapshot),
  /** Leave with a draft nothing has sent yet. */
  leaveNew: (on: Builder) => {
    on.newDraft();
    on.flight.storeOnLeave(on.save, on.latest.draft, on.latest.snapshot);
  },
  /** As the hook does on a receipt: what is stored is now the draft last sent. */
  stored: (on: Builder) => {
    on.flight.stored = on.latest.snapshot;
  },
  /** As the hook does on a receipt: the next save is edited from a new revision. */
  adopt: (on: Builder) => {
    on.counts.revisions += 1;
    on.flight.revision = `r${on.counts.revisions}`;
  },
  ok: (on: Builder) => answerSave(on, ANSWERS.ok),
  stale: (on: Builder) => answerSave(on, ANSWERS.stale),
  generic: (on: Builder) => answerSave(on, ANSWERS.generic),
  uncertain: (on: Builder) => answerSave(on, ANSWERS.uncertain),
  refused: (on: Builder) => answerSave(on, ANSWERS.refused),
  reject: (on: Builder) => on.saves.shift()?.reject(new Error('offline')),
  /** The next save throws instead of returning a promise. */
  throwNext: (on: Builder) => {
    on.flags.nextSaveThrows = true;
  },
  /** The stored draft is not the unconfirmed one: another tab wrote it. */
  recoverNone: (on: Builder) => on.recoveries.shift()?.answer.resolve(null),
  /** The stored draft IS the unconfirmed one: its revision, its ids, and the current draft re-keyed. */
  recoverMine: (on: Builder) => {
    const asked = on.recoveries.shift();
    if (!asked) return;
    const id = asked.current.id;
    asked.answer.resolve({
      revision: 'recovered-for-' + id,
      idsByKey: new Map([['key-of-' + id, 'id-of-' + id]]),
      draft: { id: id + '+ids' } as ProposalDraftState,
    });
  },
  recoverFails: (on: Builder) => on.recoveries.shift()?.answer.reject(new Error('the stored draft could not be compared')),
  /** Finish the oldest held background save or held final step. */
  finish: (on: Builder) => on.held.shift()?.step.resolve('finished'),
  /** The oldest held FINAL step rejects (a held background save never does: see the wedge story). */
  failFinal: (on: Builder) => {
    const at = on.held.findIndex((entry) => entry.kind === 'final');
    if (at >= 0) on.held.splice(at, 1)[0].step.reject(new Error('the final step failed'));
  },
  delay: (on: Builder) => on.delay(),
  clear: (on: Builder) => on.flight.clearDirty(),
  turn: (on: Builder) => on.journal.turns(1),
} satisfies Record<string, (on: Builder) => unknown>;
type Step = keyof typeof STEPS;

interface Story {
  steps: readonly Step[];
  persist?: Persist;
  /** Turns let pass after every step. */
  gap?: number;
}

/**
 * Tell one story and answer its journal. Every step is noted with what the
 * flight shows as it begins. After the last step the story is finished off,
 * six turns at a time: answer the oldest read of the stored draft with null,
 * else the oldest save with ok, else finish the oldest held step, until
 * nothing is left.
 */
async function journalOf(story: Story): Promise<string[]> {
  const on = builder(story.persist);
  const shown = (): string =>
    ['flushing=' + String(on.flight.flushing), 'revision=' + on.flight.revision, 'stored=' + on.flight.stored].join(', ');
  for (const step of story.steps) {
    on.journal.note(`> ${step} (${shown()})`);
    const waiting = STEPS[step](on);
    if (waiting instanceof Promise) await waiting;
    if (story.gap) await on.journal.turns(story.gap);
  }
  for (let round = 0; round < 60; round += 1) {
    await on.journal.turns(6);
    if (on.recoveries.length > 0) {
      on.journal.note('> (recoverNone)');
      STEPS.recoverNone(on);
    } else if (on.saves.length > 0) {
      on.journal.note('> (ok)');
      STEPS.ok(on);
    } else if (on.held.length > 0) {
      on.journal.note('> (finish)');
      STEPS.finish(on);
    } else break;
  }
  on.journal.note(`end ${shown()}`);
  return on.journal.lines;
}

const T3: readonly Step[] = ['turn', 'turn', 'turn'];
const LOST: readonly Step[] = ['send', 'reject', ...T3];
const LOST_THEN_STALE: readonly Step[] = [...LOST, 'send', 'stale', ...T3];

/** The stories a person reads: each has its whole journal in the golden-journals file. */
const NAMED: Record<string, Story> = {
  'a save answered ok': { steps: ['send', 'turn', 'ok'] },
  'a save refused for a reason of its own': { steps: ['send', 'refused'] },
  'a stale refusal with nothing unconfirmed asks nothing': { steps: ['send', 'stale'] },
  'a lost answer, then a stale refusal: the commit was ours, so adopt it and send again': {
    steps: [...LOST_THEN_STALE, 'recoverMine', ...T3, 'ok'],
  },
  'a lost answer, then a stale refusal: another tab wrote it, and the next refusal asks again': {
    steps: [...LOST_THEN_STALE, 'recoverNone', ...T3, 'send', 'stale'],
  },
  'an ok answer forgets the unconfirmed draft': { steps: [...LOST, 'send', 'ok', ...T3, 'send', 'stale'] },
  'a generic answer is remembered as unconfirmed': { steps: ['send', 'generic', ...T3, 'send', 'stale'] },
  'an uncertain answer is remembered as unconfirmed': { steps: ['send', 'uncertain', ...T3, 'send', 'stale'] },
  'a refusal of its own is not remembered': { steps: ['send', 'refused', ...T3, 'send', 'stale'] },
  'a stale refusal is not remembered': { steps: ['send', 'stale', ...T3, 'send', 'stale'] },
  'a save that threw before it was sent is remembered': { steps: ['throwNext', 'send', ...T3, 'send', 'stale'] },
  'after a recovery nothing is unconfirmed': {
    steps: [...LOST_THEN_STALE, 'recoverMine', ...T3, 'ok', ...T3, 'send', 'stale'],
  },
  'the save sent again after a recovery is remembered too': {
    steps: [...LOST_THEN_STALE, 'recoverMine', ...T3, 'reject', ...T3, 'send', 'stale'],
  },
  'the read of the stored draft fails': { steps: [...LOST_THEN_STALE, 'recoverFails', ...T3, 'leave'] },
  'each save goes out at the revision the flight holds then': { steps: ['send', 'ok', ...T3, 'adopt', 'send'] },
  'two requests during a background save queue exactly one more': {
    steps: ['request', 'request', 'request', 'turn', 'ok'],
  },
  'a flush waits for the background save and drops the queued one': {
    steps: ['request', 'request', 'flushSend', 'request', 'turn', 'ok'],
  },
  'a follow-up dropped by a flush is not run after the next save': {
    steps: ['request', 'request', 'flushSend', 'turn', 'ok', ...T3, ...T3, 'ok', ...T3, ...T3, 'request', 'ok'],
  },
  'a flush with nothing running runs its final step at once': { steps: ['flushSend', 'request', 'ok', ...T3, 'request'] },
  'a final step that throws': { steps: ['flushThrow', 'request'] },
  'a final step that rejects': { steps: ['flush', 'failFinal', ...T3, 'request'] },
  'two flushes at once': { steps: ['flush', 'flush', 'request', 'finish', 'turn', 'turn', 'request', 'leaveNew', 'finish'] },
  'leaving while the draft is being sent, after it, and once it is stored': {
    steps: ['send', 'leave', 'ok', ...T3, 'leave', ...T3, 'ok', 'stored', 'leave'],
  },
  'leaving behind a background save stores after it, at the revision adopted meanwhile': {
    steps: ['request', 'leaveNew', 'adopt', 'turn', 'ok'],
  },
  'leaving during a flush stores nothing': { steps: ['flush', 'leaveNew', 'finish'] },
  'the wait before the next save': { steps: ['delay', 'delay', 'delay', 'delay', 'send', 'delay', 'clear', 'delay'] },
  'nothing to save': { steps: ['request', 'request'], persist: 'idle' },
  'a held background save': { steps: ['request', 'request', 'finish', 'turn', 'turn', 'finish'], persist: 'held' },
};

/**
 * The grid: every pair of answers to two sends in a row with every answer of
 * the stored draft and three answers to what follows; five steps in every
 * order at three gaps; 300 seeded stories.
 */
const OUTCOMES: readonly Step[] = ['ok', 'stale', 'generic', 'uncertain', 'refused', 'reject'];
const RECOVERIES: readonly Step[] = ['recoverNone', 'recoverMine', 'recoverFails'];
const FOLLOWING: readonly Step[] = ['ok', 'reject', 'stale'];
const ORDERED: readonly Step[] = ['request', 'flushSend', 'ok', 'reject', 'leaveNew'];
const RANDOM_STEPS: readonly Step[] = [
  'request', 'request', 'send', 'send', 'flush', 'flushSend', 'flushThrow', 'leave', 'leaveNew', 'stored', 'adopt',
  'ok', 'ok', 'ok', 'stale', 'stale', 'generic', 'uncertain', 'refused', 'reject', 'reject', 'throwNext',
  'recoverNone', 'recoverMine', 'recoverMine', 'recoverFails', 'finish', 'failFinal', 'delay', 'clear',
  'turn', 'turn', 'turn', 'turn',
];
const PERSISTS: readonly Persist[] = ['sends', 'sends', 'sends', 'held', 'idle'];

function gridStories(): Array<[string, Story]> {
  const stories: Array<[string, Story]> = [];
  for (const first of OUTCOMES) {
    for (const second of OUTCOMES) {
      for (const recovery of RECOVERIES) {
        for (const third of FOLLOWING) {
          const steps: Step[] = ['send', first, ...T3, 'send', second, ...T3, recovery, ...T3, third, ...T3, 'send', 'stale'];
          stories.push([['answers', first, second, recovery, third].join('/'), { steps }]);
        }
      }
    }
  }
  for (const gap of [0, 1, 2]) {
    for (const steps of ordersOf(ORDERED)) {
      stories.push([['orders', 'gap' + String(gap), steps.join(' ')].join('/'), { steps, gap }]);
    }
  }
  const pick = seededPicker(20261202);
  for (let n = 0; n < 300; n += 1) {
    const persist = pick(PERSISTS);
    const length = pick([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const steps = Array.from({ length }, () => pick(RANDOM_STEPS));
    stories.push([['rand/' + String(n), persist, steps.join(' ')].join(': '), { steps, persist }]);
  }
  return stories;
}

describe('createDraftSaveFlight, story by story', () => {
  it.each(Object.keys(NAMED))('%s', async (name) => {
    expect(await journalOf(NAMED[name])).toEqual((recordedJournals as Record<string, string[]>)[name]);
  });

  it('has a recorded journal for every story, and for no other', () => {
    expect(Object.keys(recordedJournals)).toEqual(Object.keys(NAMED));
  });
});

describe('createDraftSaveFlight, what the stories cannot say', () => {
  it('answers the result and the draft it was handed, the very objects', async () => {
    const on = builder();
    const draft = { id: 'mine' } as ProposalDraftState;
    const answer: SaveDraftResult = { ok: true };
    const sending = on.flight.send(on.save, draft, 'snap-mine', () => undefined);
    on.saves[0].resolve(answer);
    const answered = await sending;
    expect(Object.keys(answered)).toEqual(['result', 'sent']);
    expect(answered.result).toBe(answer);
    expect(answered.sent).toBe(draft);
  });

  it('two flights do not share what is unconfirmed', async () => {
    const first = builder();
    STEPS.send(first);
    STEPS.reject(first);
    await first.journal.turns(3);
    // The second builder takes over the read of the stored draft: any read is noted in ITS journal.
    const second = builder();
    STEPS.send(second);
    STEPS.stale(second);
    await second.journal.turns(6);
    expect(second.journal.lines).toEqual([
      '0 save#1 d1 at r1',
      '3 send#1 answered {"ok":false,"error":"draft_changed_elsewhere"} sent=d1',
    ]);
    expect(second.recoveries).toHaveLength(0);
    STEPS.send(first);
    STEPS.stale(first);
    await second.journal.turns(3);
    expect(second.journal.lines.slice(2)).toEqual([
      '7 recover#1 unconfirmed=d1 current=d2',
    ]);
  });

  it('adopts the recovered revision before it hands the ids on, and sends nothing again when that callback throws', async () => {
    const on = builder();
    STEPS.send(on);
    STEPS.reject(on);
    await on.journal.turns(3);
    const outcome = on.flight
      .send(on.save, { id: 'next' } as ProposalDraftState, 'snap-next', () => {
        on.journal.note('onRecovered throws, revision=' + on.flight.revision);
        throw new Error('the callback threw');
      })
      .then(
        () => 'answered',
        (cause: unknown) => String(cause),
      );
    STEPS.stale(on);
    await on.journal.turns(3);
    STEPS.recoverMine(on);
    await on.journal.turns(3);
    expect(await outcome).toBe('Error: the callback threw');
    expect(on.journal.lines).toEqual([
      '0 save#1 d1 at r1',
      '3 send#1 answered {"ok":false,"error":"uncertain"} sent=d1',
      '3 save#2 next at r1',
      '4 recover#1 unconfirmed=d1 current=next',
      '6 onRecovered throws, revision=recovered-for-next',
    ]);
    expect(on.saves).toHaveLength(0);
    expect(on.flight.revision).toBe('recovered-for-next');
  });

  it('is called unbound by the debounce timer', () => {
    const on = builder();
    const { request } = on.flight;
    request();
    expect(on.journal.lines).toEqual(['0 persist#1', '0 save#1 d1 at r1']);
  });

  // FOUND, NOT CHANGED: nothing clears `running` when the background save REJECTS.
  it('a background save that rejects leaves the flight unable to save or to flush', async () => {
    const on = builder('held');
    on.flight.request();
    on.flush(() => on.holdStep('final'));
    on.held[0].step.reject(new Error('the background save rejected'));
    await on.journal.turns(4);
    on.flight.request();
    on.flush(() => on.holdStep('final'));
    await on.journal.turns(4);
    expect(on.journal.lines).toEqual([
      '0 persist#1',
      '2 flush#1 rejected Error: the background save rejected',
      '5 flush#2 rejected Error: the background save rejected',
    ]);
    expect(on.flight.flushing).toBe(false);
  });
});

describe('createDraftSaveFlight, the grid', () => {
  it('324 answer stories, five steps in every order at three gaps, and 300 seeded stories', async () => {
    const digests: Record<string, string> = {};
    for (const [id, story] of gridStories()) digests[id] = digestOf((await journalOf(story)).join('\n'));
    expect(Object.keys(digests)).toHaveLength(984);
    expect(digests).toEqual(recordedDigests);
  });
});
