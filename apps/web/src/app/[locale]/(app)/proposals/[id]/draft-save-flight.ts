import { recoverLostCommit } from './lost-commit';
import type { SaveDraft, SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

/**
 * The builder's single-flight save engine, free of React. ONE save at a time: a
 * request while a save runs queues exactly one more; `flush` waits for every
 * running save, then runs its own final step as the one in flight, and ignores
 * background requests meanwhile. It also carries the revision each save is
 * edited from, the snapshots of what is stored and of what is being sent, the
 * draft of a send that never answered (it may have committed: lost-commit.ts),
 * and the clock of the first unsaved change.
 */
export interface DraftSaveFlight {
  /** Start a background save now, or queue exactly one more if one is running. */
  request(): void;
  /** Wait for the running saves, then run `finalStep` as the save in flight. */
  flush<T>(finalStep: () => Promise<T>): Promise<T>;
  /**
   * Send `draft` (whose snapshot is `snapshot`) through `save`. Refused as stale
   * while an earlier send's answer was lost: if what is stored is that send, it
   * was ours, so adopt it (through `onRecovered`) and send again, once. Answers
   * the draft last sent.
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
  // The draft of a send that never answered: it may have committed.
  let unconfirmed: ProposalDraftState | null = null;

  async function sendOnce(save: SaveDraft, draft: ProposalDraftState): Promise<SaveDraftResult> {
    try {
      const result = await save(draft, flight.revision);
      if (result.ok) unconfirmed = null;
      else if (result.error === 'generic' || result.error === 'uncertain') unconfirmed = draft;
      return result;
    } catch {
      unconfirmed = draft;
      return { ok: false, error: 'generic' };
    }
  }

  async function sendRecovering(
    save: SaveDraft,
    draft: ProposalDraftState,
    onRecovered: (idsByKey: Map<string, string>) => void,
  ): Promise<{ result: SaveDraftResult; sent: ProposalDraftState }> {
    const result = await sendOnce(save, draft);
    if (result.ok || result.error !== 'draft_changed_elsewhere' || !unconfirmed) {
      return { result, sent: draft };
    }
    const recovered = await recoverLostCommit(unconfirmed, draft);
    if (!recovered) return { result, sent: draft };
    unconfirmed = null;
    flight.revision = recovered.revision;
    onRecovered(recovered.idsByKey);
    return { result: await sendOnce(save, recovered.draft), sent: recovered.draft };
  }

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
      running = started.then(() => {
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
        return await sendRecovering(save, draft, onRecovered);
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
  return flight;
}
