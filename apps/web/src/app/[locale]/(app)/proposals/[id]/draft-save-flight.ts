import { DRAFT_ANSWER_DEADLINE_MS, NO_ANSWER, settleWithinDeadline } from './draft-answer-deadline';
import { recoverLostCommit } from './lost-commit';
import type { SaveDraft, SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';
import { unconfirmedAfter, type UnconfirmedSend } from './unconfirmed-sends';

/**
 * The builder's single-flight save engine, free of React. ONE save at a time: a
 * request while a save runs queues exactly one more; `flush` waits for every
 * running save, then runs its own final step as the one in flight, and ignores
 * background requests meanwhile. It also carries the revision each save is
 * edited from, the snapshots of what is stored and of what is being sent, the
 * drafts of the sends that never answered (one may have committed: lost-commit.ts),
 * and the clock of the first unsaved change. A save with no answer within the
 * deadline (draft-answer-deadline.ts) is a send that never answered, so no save
 * holds the flight for ever.
 */
export interface DraftSaveFlight {
  /** Start a background save now, or queue exactly one more if one is running. */
  request(): void;
  /** Wait for the running saves, then run `finalStep` as the save in flight. */
  flush<T>(finalStep: () => Promise<T>): Promise<T>;
  /**
   * Send `draft` (whose snapshot is `snapshot`) through `save`. Refused as stale
   * while earlier sends' answers were lost: if what is stored is one of them, it
   * was ours, so adopt it (through `onRecovered`) and send again, once. If what
   * is stored cannot be read, the answer is `uncertain`, not the refusal: whose
   * commit it was is still unknown. Answers the draft last sent.
   */
  send(
    save: SaveDraft,
    draft: ProposalDraftState,
    snapshot: string,
    onRecovered: (idsByKey: Map<string, string>) => void,
  ): Promise<{ result: SaveDraftResult; sent: ProposalDraftState }>;
  /** Leaving: store `draft` once after the running save, unless a flush or a send already carries it. */
  storeOnLeave(save: SaveDraft, draft: ProposalDraftState, snapshot: string): void;
  /** Milliseconds until the next background save: the debounce, capped by the max wait. */
  delayUntilSave(now: number, debounceMs: number, maxWaitMs: number): number;
  clearDirty(): void;
  readonly flushing: boolean;
  /** The revision the next save is edited from (adopted from each receipt). */
  revision: string;
  /** The snapshot of what the server stores. */
  stored: string;
}

/**
 * `persist` starts one background save, or answers null when there is nothing
 * to save (then no save is in flight).
 */
export function createDraftSaveFlight(
  persist: () => Promise<unknown> | null,
  initial: { revision: string; stored: string },
): DraftSaveFlight {
  let running: Promise<unknown> | null = null;
  let followUp = false;
  let flushing = false;
  let firstUnsavedAt: number | null = null;
  let sending: string | null = null;

  const flight: DraftSaveFlight = {
    revision: initial.revision,
    stored: initial.stored,
    get flushing() {
      return flushing;
    },
    request(): void {
      if (flushing) return;
      if (running) {
        followUp = true;
        return;
      }
      const started = persist();
      if (!started) return;
      running = whenSettled(started, () => {
        running = null;
        if (!followUp || flushing) return;
        followUp = false;
        flight.request();
      });
    },
    async flush<T>(finalStep: () => Promise<T>): Promise<T> {
      flushing = true;
      followUp = false;
      try {
        while (running) await running;
        const run = finalStep();
        running = run;
        try {
          return await run;
        } finally {
          running = null;
        }
      } finally {
        flushing = false;
      }
    },
    async send(save, draft, snapshot, onRecovered) {
      firstUnsavedAt = null;
      sending = snapshot;
      try {
        return await sendRecovering(save, { draft, snapshot }, onRecovered);
      } finally {
        sending = null;
      }
    },
    storeOnLeave(save, draft, snapshot): void {
      if (flushing || snapshot === flight.stored || snapshot === sending) return;
      void Promise.resolve(running)
        .then(() => save(draft, flight.revision))
        .catch(() => undefined);
    },
    delayUntilSave(now, debounceMs, maxWaitMs): number {
      firstUnsavedAt ??= now;
      return Math.max(0, Math.min(debounceMs, firstUnsavedAt + maxWaitMs - now));
    },
    clearDirty(): void {
      firstUnsavedAt = null;
    },
  };
  const sendRecovering = createRecoveringSend(flight);
  return flight;
}

/**
 * Runs `afterwards` once a background save settles, rejected or not, so a save
 * that throws cannot hold the flight for the life of the tab. What it answers
 * never rejects: a flush and a leave store wait on it. The failure is raised
 * again as the unhandled rejection it always was, not hidden here.
 */
function whenSettled(save: Promise<unknown>, afterwards: () => void): Promise<void> {
  return save.then(afterwards, (cause: unknown) => {
    void Promise.reject(cause);
    afterwards();
  });
}

/**
 * The send of one flight, with a memory: the drafts of the sends that never
 * answered are kept (unconfirmed-sends.ts), and when a later send is refused as
 * stale they settle whose commit it was (lost-commit.ts). It reads the revision
 * to save against from `flight` and adopts the recovered one onto it.
 */
function createRecoveringSend(flight: Pick<DraftSaveFlight, 'revision'>) {
  // The sends since the last confirmed save that never answered, newest first:
  // one of them may have committed.
  let unconfirmed: readonly UnconfirmedSend[] = [];

  /** One save, answered within the deadline, and what its answer leaves unconfirmed. */
  function sendOnce(save: SaveDraft, sent: UnconfirmedSend): Promise<SaveDraftResult> {
    return settleWithinDeadline(
      () => save(sent.draft, flight.revision),
      DRAFT_ANSWER_DEADLINE_MS,
      (answer) => {
        // The answer never came back, so the save may or may not have committed:
        // exactly what `uncertain` says, and lost-commit.ts settles which.
        const result: SaveDraftResult = answer === NO_ANSWER ? { ok: false, error: 'uncertain' } : answer;
        unconfirmed = unconfirmedAfter(unconfirmed, sent, result);
        return result;
      },
    );
  }

  async function sendRecovering(
    save: SaveDraft,
    sent: UnconfirmedSend,
    onRecovered: (idsByKey: Map<string, string>) => void,
  ): Promise<{ result: SaveDraftResult; sent: ProposalDraftState }> {
    const { draft, snapshot } = sent;
    const result = await sendOnce(save, sent);
    const [latest, ...earlier] = unconfirmed.map((lost) => lost.draft);
    if (result.ok || result.error !== 'draft_changed_elsewhere' || !latest) {
      return { result, sent: draft };
    }
    const recovered = await recoverLostCommit(latest, draft, earlier);
    // Nothing is forgotten here: the next send is refused again and reads again.
    if (recovered === 'unreadable') return { result: { ok: false, error: 'uncertain' }, sent: draft };
    if (!recovered) return { result, sent: draft };
    unconfirmed = [];
    flight.revision = recovered.revision;
    onRecovered(recovered.idsByKey);
    // The send again is the same send, re-keyed with the stored ids: same snapshot.
    return { result: await sendOnce(save, { draft: recovered.draft, snapshot }), sent: recovered.draft };
  }

  return sendRecovering;
}
