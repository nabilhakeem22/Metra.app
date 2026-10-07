'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedChangesPrompt } from '@/hooks/use-unsaved-changes-prompt';
import type { ActionCode } from '@/lib/actions/result';
import { firstIncompleteField, type DraftField } from './draft-completeness';
import { lineIdsByKey, withLineIds } from './draft-save-receipt';
import { exceedsDraftSaveLimit } from './draft-size';
import { autosaveDraft, persistDraft, type SaveDraft, type SaveDraftResult } from './persist-draft';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

export type DraftSaveState = 'saved' | 'dirty' | 'saving' | 'failed';

export const AUTOSAVE_DEBOUNCE_MS = 1500;
/** Continuous editing still saves at least this often. */
export const AUTOSAVE_MAX_WAIT_MS = 10_000;

export interface DraftAutosaveApi {
  saveState: DraftSaveState;
  /** Unsaved, and waiting for a field the server would refuse (draft-completeness.ts). */
  incomplete: boolean;
  lastSavedAt: Date | null;
  error: ActionCode | null;
  flush: () => Promise<SaveDraftResult>;
  retry: () => void;
}

/** What a save would send, as one comparable string. */
const snapshotOf = (state: ProposalDraftState) => JSON.stringify(buildProposalPayload(state));

/**
 * The proposal builder saves itself. The state is DERIVED: saved when what a save
 * would send equals what was last stored (so undoing an edit is "saved" again),
 * failed when the last attempt at exactly this content was refused, else dirty.
 * It saves silently 1.5 s after the last edit, and at least every 10 s while
 * editing goes on; never while a line or section is still unfinished. ONE save at
 * a time; an edit during a save queues one more. Each save sends the revision it
 * was edited from and adopts the receipt (new revision, the ids of new lines,
 * through `onStored`). `flush()` (Send, Send as BOQ, Back, leaving) waits for a
 * running save, then stores the rest with the refreshing save, naming the first
 * unfinished field through `onIncomplete` instead.
 */
export function useDraftAutosave(input: {
  draft: ProposalDraftState;
  revision: string;
  enabled: boolean;
  onStored: (idsByKey: ReadonlyMap<string, string>) => void;
  onIncomplete: (field: DraftField) => void;
  debounceMs?: number;
  maxWaitMs?: number;
}): DraftAutosaveApi {
  const { draft, enabled, debounceMs = AUTOSAVE_DEBOUNCE_MS, maxWaitMs = AUTOSAVE_MAX_WAIT_MS } = input;
  const { id, sections, discountPct, taxRate, supervisionPct, seeMargin } = draft;
  const snapshot = useMemo(
    () => snapshotOf({ id, sections, discountPct, taxRate, supervisionPct, seeMargin }),
    [id, sections, discountPct, taxRate, supervisionPct, seeMargin],
  );
  const latest = useRef({ draft, snapshot, enabled, callbacks: input });
  const revision = useRef(input.revision);
  const stored = useRef(snapshot);
  const [storedSnapshot, setStoredSnapshot] = useState(snapshot);
  const [failure, setFailure] = useState<{ code: ActionCode; snapshot: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const inFlightSnapshot = useRef<string | null>(null);
  const followUp = useRef(false);
  const flushing = useRef(false);
  const dirtySince = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Store the latest draft through `save` and adopt what the server answered. */
  async function saveLatest(save: SaveDraft): Promise<SaveDraftResult> {
    const { draft: toSave, snapshot: savedAs } = latest.current;
    if (exceedsDraftSaveLimit(savedAs)) {
      setFailure({ code: 'draft_too_large', snapshot: savedAs });
      return { ok: false, error: 'draft_too_large' };
    }
    dirtySince.current = null;
    inFlightSnapshot.current = savedAs;
    setSaving(true);
    let result: SaveDraftResult;
    try {
      result = await save(toSave, revision.current);
    } catch {
      result = { ok: false, error: 'generic' };
    }
    inFlightSnapshot.current = null;
    setSaving(false);
    if (!result.ok) {
      setFailure({ code: (result.error as ActionCode | undefined) ?? 'generic', snapshot: savedAs });
      return result;
    }
    const idsByKey = result.data ? lineIdsByKey(toSave.sections, result.data) : new Map<string, string>();
    if (result.data) revision.current = result.data.revision;
    stored.current = snapshotOf({ ...toSave, sections: withLineIds(toSave.sections, idsByKey) });
    setStoredSnapshot(stored.current);
    setFailure(null);
    setLastSavedAt(new Date());
    latest.current.callbacks.onStored(idsByKey);
    return result;
  }

  function autosave(): void {
    if (flushing.current) return;
    if (inFlight.current) {
      followUp.current = true;
      return;
    }
    const { draft: current, snapshot: now } = latest.current;
    if (now === stored.current || firstIncompleteField(current.sections)) return;
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
    clearTimeout(timer.current);
    try {
      while (inFlight.current) await inFlight.current;
      const { draft: current, snapshot: now } = latest.current;
      if (now === stored.current) return { ok: true };
      const field = firstIncompleteField(current.sections);
      if (field) {
        setFailure({ code: 'draft_incomplete', snapshot: now });
        latest.current.callbacks.onIncomplete(field);
        return { ok: false, error: 'draft_incomplete' };
      }
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
    latest.current = { draft, snapshot, enabled, callbacks: input };
  });

  // Leaving by a way the link guard cannot see (Back, a typed URL) still stores
  // what the wait had not, once, unless a running save already carries it.
  useEffect(() => () => {
    const last = latest.current;
    if (!last.enabled || flushing.current) return;
    if (last.snapshot === stored.current || last.snapshot === inFlightSnapshot.current) return;
    if (firstIncompleteField(last.draft.sections)) return;
    void Promise.resolve(inFlight.current)
      .then(() => autosaveDraft(last.draft, revision.current))
      .catch(() => undefined);
  }, []);

  // The debounce, with a ceiling: each change restarts the wait, but never past
  // `maxWaitMs` from the first unsaved change (`autosave` reads only refs).
  useEffect(() => {
    if (!enabled || snapshot === storedSnapshot) {
      dirtySince.current = null;
      return;
    }
    dirtySince.current ??= Date.now();
    const untilCeiling = dirtySince.current + maxWaitMs - Date.now();
    timer.current = setTimeout(autosave, Math.max(0, Math.min(debounceMs, untilCeiling)));
    return () => clearTimeout(timer.current);
  }, [snapshot, storedSnapshot, enabled, debounceMs, maxWaitMs]);

  const saveState: DraftSaveState = saving
    ? 'saving'
    : snapshot === storedSnapshot
      ? 'saved'
      : failure?.snapshot === snapshot
        ? 'failed'
        : 'dirty';
  useUnsavedChangesPrompt(enabled && saveState !== 'saved');

  function retry(): void {
    clearTimeout(timer.current);
    const field = firstIncompleteField(latest.current.draft.sections);
    if (field) latest.current.callbacks.onIncomplete(field);
    else autosave();
  }

  return {
    saveState,
    incomplete: saveState === 'dirty' && firstIncompleteField(sections) !== null,
    lastSavedAt,
    error: saveState === 'failed' ? (failure?.code ?? null) : null,
    flush,
    retry,
  };
}
