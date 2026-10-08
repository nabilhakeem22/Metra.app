'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedChangesPrompt } from '@/hooks/use-unsaved-changes-prompt';
import type { ActionCode } from '@/lib/actions/result';
import { firstIncompleteField, type DraftField } from './draft-completeness';
import { createDraftSaveFlight } from './draft-save-flight';
import { lineIdsByKey, withLineIds } from './draft-save-receipt';
import { draftSaveStateOf, snapshotOf, type DraftSaveState } from './draft-save-state';
import { exceedsDraftSaveLimit } from './draft-size';
import { autosaveDraft, persistDraft, type SaveDraft, type SaveDraftResult } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

export type { DraftSaveState } from './draft-save-state';

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

/**
 * The proposal builder saves itself, silently, 1.5 s after the last edit and at
 * least every 10 s while editing goes on; never while a line or section is
 * unfinished. One save at a time (draft-save-flight.ts); each adopts its receipt
 * (revision, new line ids through `onStored`). `flush()` (Send, Send as BOQ, Back,
 * leaving) waits for a running save, then stores the rest with the refreshing
 * save, or names the first unfinished field through `onIncomplete`.
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
  const [storedSnapshot, setStoredSnapshot] = useState(snapshot);
  const [failure, setFailure] = useState<{ code: ActionCode; snapshot: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [flight] = useState(() =>
    createDraftSaveFlight(startAutosave, { revision: input.revision, stored: snapshot }),
  );

  /** Store the latest draft through `save` and adopt what the server answered. */
  async function saveLatest(save: SaveDraft): Promise<SaveDraftResult> {
    const savedAs = latest.current.snapshot;
    if (exceedsDraftSaveLimit(savedAs)) {
      setFailure({ code: 'draft_too_large', snapshot: savedAs });
      return { ok: false, error: 'draft_too_large' };
    }
    setSaving(true);
    const { result, sent } = await flight.send(save, latest.current.draft, savedAs, (idsByKey) =>
      latest.current.callbacks.onStored(idsByKey),
    );
    setSaving(false);
    if (!result.ok) {
      setFailure({ code: (result.error as ActionCode | undefined) ?? 'generic', snapshot: savedAs });
      return result;
    }
    const idsByKey = result.data ? lineIdsByKey(sent.sections, result.data) : new Map<string, string>();
    if (result.data) flight.revision = result.data.revision;
    flight.stored = snapshotOf({ ...sent, sections: withLineIds(sent.sections, idsByKey) });
    setStoredSnapshot(flight.stored);
    setFailure(null);
    setLastSavedAt(new Date());
    latest.current.callbacks.onStored(idsByKey);
    return result;
  }

  /** The background save the flight starts; null when there is nothing to store. */
  function startAutosave(): Promise<SaveDraftResult> | null {
    const { draft: current, snapshot: now } = latest.current;
    if (now === flight.stored || firstIncompleteField(current.sections)) return null;
    return saveLatest(autosaveDraft);
  }

  function flush(): Promise<SaveDraftResult> {
    clearTimeout(timer.current);
    return flight.flush(async (): Promise<SaveDraftResult> => {
      const { draft: current, snapshot: now } = latest.current;
      if (now === flight.stored) return { ok: true };
      const field = firstIncompleteField(current.sections);
      if (!field) return saveLatest(persistDraft);
      setFailure({ code: 'draft_incomplete', snapshot: now });
      latest.current.callbacks.onIncomplete(field);
      return { ok: false, error: 'draft_incomplete' };
    });
  }

  useEffect(() => {
    latest.current = { draft, snapshot, enabled, callbacks: input };
  });

  // Leaving by a way the link guard cannot see (Back, a typed URL) still stores
  // what the wait had not, once, unless a running save already carries it.
  useEffect(() => () => {
    const last = latest.current;
    if (!last.enabled || firstIncompleteField(last.draft.sections)) return;
    flight.storeOnLeave(autosaveDraft, last.draft, last.snapshot);
  }, [flight]);

  // The debounce, with a ceiling: each change restarts the wait, but never past
  // `maxWaitMs` from the first unsaved change (the flight reads only refs).
  useEffect(() => {
    if (!enabled || snapshot === storedSnapshot) {
      flight.clearDirty();
      return;
    }
    timer.current = setTimeout(flight.request, flight.delayUntilSave(Date.now(), debounceMs, maxWaitMs));
    return () => clearTimeout(timer.current);
  }, [snapshot, storedSnapshot, enabled, debounceMs, maxWaitMs, flight]);

  const saveState = draftSaveStateOf({ saving, snapshot, storedSnapshot, refusedSnapshot: failure?.snapshot });
  useUnsavedChangesPrompt(enabled && saveState !== 'saved');

  function retry(): void {
    clearTimeout(timer.current);
    const field = firstIncompleteField(latest.current.draft.sections);
    if (field) latest.current.callbacks.onIncomplete(field);
    else flight.request();
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
