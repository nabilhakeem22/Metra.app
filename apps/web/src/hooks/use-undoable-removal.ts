'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResult } from '@/lib/actions/result';
import { registerPendingRemovals } from './pending-removals';
import { showUndoToast, type UndoToastHandle } from './undo-toast';

export interface UndoableRemovalOptions {
  /** The real delete, run once the Undo toast has closed without Undo. */
  commit: (id: string) => Promise<ActionResult>;
  messages: { removed: string; undo: string };
  /** After a delete lands, e.g. `router.refresh()` (also after a flush on leave). */
  onCommitted?: () => void;
  /** A delete the server refused: the caller shows `resolveActionError(...)`. */
  onFailed: (result: ActionResult) => void;
}

const FAILED: ActionResult = { ok: false, error: 'generic' };

/**
 * A DEFERRED delete with Undo, for content rows (documents, contacts, BOQ lines).
 * `remove(id)` hides the row at once and shows an Undo toast. ONE CLOCK: the
 * server delete runs when that toast closes for any reason but Undo (its timer,
 * which Radix pauses while the toast is hovered or focused, a dismiss, or
 * eviction by the toast limit), never before. So an Undo that is on screen
 * always works, and nothing is deleted while it is.
 *
 * Anything that must commit EARLY (leaving the screen, the page being hidden,
 * sign-out, a whole-document action via `flushPendingRemovals`) commits and
 * closes the toast in the same step, so a stale Undo can never be clicked. A
 * refused delete brings the row back and reports it. Best effort only: a hard
 * tab close can still end the page before `pagehide` is delivered, and then the
 * delete simply never happens (the row is back on the next visit).
 */
export function useUndoableRemoval(options: UndoableRemovalOptions): {
  hiddenIds: ReadonlySet<string>;
  remove: (id: string) => void;
  /** Commit every pending delete now (closing its toast); true when all landed. */
  flush: () => Promise<boolean>;
} {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Map<string, UndoToastHandle>());
  // Deletes sent to the server and not yet answered.
  const inFlight = useRef(new Map<string, Promise<boolean>>());
  const mounted = useRef(true);
  // The latest options, so a toast that closes after a re-render commits with
  // the caller's current callbacks rather than the ones it was armed with.
  const latest = useRef(options);
  latest.current = options;

  const setHidden = useCallback((id: string, hidden: boolean) => {
    if (!mounted.current) return;
    setHiddenIds((current) => {
      const next = new Set(current);
      if (hidden) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const sendDelete = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await latest.current.commit(id).catch(() => FAILED);
      if (result.ok) {
        latest.current.onCommitted?.();
        return true;
      }
      setHidden(id, false);
      latest.current.onFailed(result);
      return false;
    },
    [setHidden],
  );

  const commit = useCallback(
    (id: string): Promise<boolean> => {
      const toastHandle = pending.current.get(id);
      if (!toastHandle) return inFlight.current.get(id) ?? Promise.resolve(true);
      pending.current.delete(id);
      // Close the toast in the same step: no Undo may outlive the decision.
      toastHandle.dismiss();
      const landed = sendDelete(id).finally(() => inFlight.current.delete(id));
      inFlight.current.set(id, landed);
      return landed;
    },
    [sendDelete],
  );

  // Waits for every delete already sent too, so a whole-document action never
  // starts while the server is still answering one.
  const flush = useCallback(async () => {
    const landed = await Promise.all([
      ...[...pending.current.keys()].map(commit),
      ...inFlight.current.values(),
    ]);
    return landed.every(Boolean);
  }, [commit]);

  const remove = useCallback(
    (id: string) => {
      if (pending.current.has(id)) return;
      setHidden(id, true);
      const toastHandle = showUndoToast({
        title: latest.current.messages.removed,
        undoLabel: latest.current.messages.undo,
        onUndo: () => {
          if (!pending.current.delete(id)) return;
          setHidden(id, false);
        },
        onExpire: () => void commit(id),
      });
      pending.current.set(id, toastHandle);
    },
    [commit, setHidden],
  );

  // Leaving the screen, or the page going to the background, is not an Undo:
  // commit what is pending now. Registered too, so the app-wide flush reaches it.
  useEffect(() => {
    mounted.current = true;
    const onPageHide = () => void flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    const unregister = registerPendingRemovals(
      flush,
      () => pending.current.size + inFlight.current.size,
    );
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      unregister();
      void flush();
    };
  }, [flush]);

  return { hiddenIds, remove, flush };
}
