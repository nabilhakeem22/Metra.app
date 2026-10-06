'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResult } from '@/lib/actions/result';
import { showUndoToast, UNDO_WINDOW_MS } from './undo-toast';

export interface UndoableRemovalOptions {
  /** The real delete, run once the Undo window has passed. */
  commit: (id: string) => Promise<ActionResult>;
  messages: { removed: string; undo: string };
  /** After a delete lands, e.g. `router.refresh()`. */
  onCommitted?: () => void;
  /** A delete the server refused: the caller shows `resolveActionError(...)`. */
  onFailed: (result: ActionResult) => void;
}

const FAILED: ActionResult = { ok: false, error: 'generic' };

/**
 * A DEFERRED delete with Undo, for content rows (documents, contacts, BOQ lines).
 * `remove(id)` hides the row at once and offers Undo for UNDO_WINDOW_MS; the
 * server delete runs only when that window passes. Undo inside it means nothing
 * was ever deleted. Leaving the screen early commits every pending delete at
 * once; closing the tab inside the window deletes nothing (fail-safe: the row
 * is simply back on the next visit). No restore path on the server is needed.
 */
export function useUndoableRemoval(options: UndoableRemovalOptions): {
  hiddenIds: ReadonlySet<string>;
  remove: (id: string) => void;
} {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // The latest options, so a timer that fires after a re-render commits with
  // the caller's current callbacks rather than the ones it was armed with.
  const latest = useRef(options);
  latest.current = options;

  const setHidden = useCallback((id: string, hidden: boolean) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (hidden) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const commitNow = useCallback(
    async (id: string) => {
      timers.current.delete(id);
      const result = await latest.current.commit(id).catch(() => FAILED);
      if (result.ok) {
        latest.current.onCommitted?.();
        return;
      }
      setHidden(id, false);
      latest.current.onFailed(result);
    },
    [setHidden],
  );

  const remove = useCallback(
    (id: string) => {
      if (timers.current.has(id)) return;
      setHidden(id, true);
      timers.current.set(
        id,
        setTimeout(() => void commitNow(id), UNDO_WINDOW_MS),
      );
      showUndoToast({
        title: latest.current.messages.removed,
        undoLabel: latest.current.messages.undo,
        onUndo: () => {
          const timer = timers.current.get(id);
          if (timer === undefined) return;
          clearTimeout(timer);
          timers.current.delete(id);
          setHidden(id, false);
        },
      });
    },
    [commitNow, setHidden],
  );

  // Leaving the screen is not an Undo: flush every pending delete now.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const [id, timer] of pending) {
        clearTimeout(timer);
        void latest.current
          .commit(id)
          .catch(() => FAILED)
          .then((result) => {
            if (!result.ok) latest.current.onFailed(result);
          });
      }
      pending.clear();
    };
  }, []);

  return { hiddenIds, remove };
}
