'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedChangesPrompt } from '@/hooks/use-unsaved-changes-prompt';
import type { ActionCode } from '@/lib/actions/result';
import { autosaveDraft, persistDraft, type SaveDraftResult } from './persist-draft';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

export type DraftSaveState = 'saved' | 'dirty' | 'saving' | 'failed';

export const AUTOSAVE_DEBOUNCE_MS = 1500;

export interface DraftAutosaveApi {
  saveState: DraftSaveState;
  lastSavedAt: Date | null;
  error: ActionCode | null;
  flush: () => Promise<SaveDraftResult>;
  retry: () => void;
}

type SaveDraft = (state: ProposalDraftState) => Promise<SaveDraftResult>;

/** What a save would send, as one comparable string. */
const snapshotOf = (state: ProposalDraftState) => JSON.stringify(buildProposalPayload(state));

/**
 * The proposal builder saves itself. Dirty = what a save would send differs from
 * what was last stored. After `debounceMs` without an edit it saves silently
 * (`autosaveDraft`, no app refresh). ONE save at a time: an edit made while a
 * save runs queues exactly one more. A failure stops there (`failed`, with the
 * code) until the next edit or `retry()`; nothing loops. `flush()` is what Send,
 * Send as BOQ and Back call: it cancels the wait, lets a running save finish,
 * then stores the latest draft with the refreshing save if anything is unsaved.
 * Closing the tab while anything is unsaved asks first.
 */
export function useDraftAutosave(input: {
  draft: ProposalDraftState;
  enabled: boolean;
  debounceMs?: number;
}): DraftAutosaveApi {
  const { draft, enabled, debounceMs = AUTOSAVE_DEBOUNCE_MS } = input;
  const { id, sections, discountPct, taxRate, supervisionPct, seeMargin } = draft;
  const snapshot = useMemo(
    () => snapshotOf({ id, sections, discountPct, taxRate, supervisionPct, seeMargin }),
    [id, sections, discountPct, taxRate, supervisionPct, seeMargin],
  );
  const latest = useRef({ draft, snapshot, enabled });
  const savedSnapshot = useRef(snapshot);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const followUp = useRef(false);
  const flushing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<DraftSaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<ActionCode | null>(null);

  /** Store the latest draft through `save`, keeping the indicator truthful. */
  async function saveLatest(save: SaveDraft): Promise<SaveDraftResult> {
    const { draft: toSave, snapshot: savedAs } = latest.current;
    setSaveState('saving');
    let result: SaveDraftResult;
    try {
      result = await save(toSave);
    } catch {
      result = { ok: false, error: 'generic' };
    }
    if (result.ok) {
      savedSnapshot.current = savedAs;
      setLastSavedAt(new Date());
      setError(null);
      setSaveState(latest.current.snapshot === savedAs ? 'saved' : 'dirty');
    } else {
      setError((result.error as ActionCode | undefined) ?? 'generic');
      setSaveState('failed');
    }
    return result;
  }

  function autosave(): void {
    if (flushing.current) return;
    if (inFlight.current) {
      followUp.current = true;
      return;
    }
    if (latest.current.snapshot === savedSnapshot.current) {
      setSaveState('saved');
      return;
    }
    inFlight.current = saveLatest(autosaveDraft).then(() => {
      inFlight.current = null;
      if (!followUp.current || flushing.current) return;
      followUp.current = false;
      autosave();
    });
  }

  async function flush(): Promise<SaveDraftResult> {
    flushing.current = true;
    followUp.current = false;
    if (timer.current) clearTimeout(timer.current);
    try {
      while (inFlight.current) await inFlight.current;
      if (latest.current.snapshot === savedSnapshot.current) return { ok: true };
      const run = saveLatest(persistDraft);
      inFlight.current = run;
      try {
        return await run;
      } finally {
        inFlight.current = null;
      }
    } finally {
      flushing.current = false;
    }
  }

  useEffect(() => {
    latest.current = { draft, snapshot, enabled };
  });

  // Leaving the builder inside the app (no beforeunload there) stores what the
  // wait had not, after any save still running.
  useEffect(() => () => {
    const last = latest.current;
    if (!last.enabled || flushing.current || last.snapshot === savedSnapshot.current) return;
    void Promise.resolve(inFlight.current).then(() => autosaveDraft(last.draft)).catch(() => undefined);
  }, []);

  // The debounce: every change of what a save would send restarts the wait
  // (`autosave` reads only refs, so the render it closes over does not matter).
  useEffect(() => {
    if (!enabled) return;
    if (snapshot === savedSnapshot.current) {
      if (!inFlight.current) setSaveState((state) => (state === 'dirty' ? 'saved' : state));
      return;
    }
    if (!inFlight.current) setSaveState('dirty');
    timer.current = setTimeout(autosave, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [snapshot, enabled, debounceMs]);

  useUnsavedChangesPrompt(enabled && saveState !== 'saved');

  function retry(): void {
    if (timer.current) clearTimeout(timer.current);
    autosave();
  }

  return { saveState, lastSavedAt, error, flush, retry };
}
