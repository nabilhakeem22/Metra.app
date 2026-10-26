'use client';

import { useState, useTransition } from 'react';

/**
 * Client Deliverables, Step 2 — the state machine BEHIND a document comment thread,
 * shared by the client portal and the studio cockpit so the two can never drift.
 *
 * Headless on purpose. The two surfaces have genuinely different design systems
 * (the portal uses shadcn semantic classes, the cockpit uses Metra's `--token`
 * palette) and different server actions, so their MARKUP is legitimately separate.
 * Their behaviour is not: both are collapsed-by-default, both fetch lazily on open
 * until a read has completed, both re-read after a send rather than appending
 * locally (a failed re-read keeps what is shown), and both wrap the await so a
 * rejected action can never strand the spinner. That behaviour
 * lives here, once.
 *
 * Generic over the message type because the two readers return different shapes —
 * the client sees no staff identity, the studio sees author ids — and neither should
 * be widened to accommodate the other.
 */
/** The error code of a thread that could not be READ (nothing was sent). */
const THREAD_LOAD_FAILED = 'load_failed';

export interface DocumentThread<TMessage> {
  /** Is the thread expanded? */
  open: boolean;
  /** Has a fetch actually completed? Distinguishes "empty" from "not yet loaded". */
  loaded: boolean;
  messages: TMessage[];
  /** Messages are shown but the last read failed, so some may be missing. */
  partial: boolean;
  draft: string;
  setDraft: (value: string) => void;
  /** THREAD_LOAD_FAILED while the last read failed, or null. A refused send is
   *  never here: it is said through `refusals`. */
  error: typeof THREAD_LOAD_FAILED | null;
  /** A first load is in flight. */
  loading: boolean;
  /** A send is in flight. */
  sending: boolean;
  /** Expand/collapse, fetching on an expand while nothing has loaded yet. */
  toggle: () => void;
  /** Send the trimmed draft, then re-read. No-op on a blank draft. */
  send: () => void;
}

/** Where a refused or failed send is said: under the message box (the
 *  field-errors hook is one), with the reference of an unknown failure. */
export interface ThreadSendRefusals<TResult> {
  /** Says a failed result and answers true; answers false for a success. */
  applyResult(result: TResult): boolean;
  applyRejection(rejection: unknown): void;
}

export function useDocumentThread<
  TMessage,
  TResult extends { ok: boolean; error?: string } = { ok: boolean; error?: string },
>(options: {
  /** Read the thread. Resolves to `[]` on a miss; REJECTS when the read was refused
   *  (not an empty thread), which shows THREAD_LOAD_FAILED and keeps `loaded` false. */
  load: () => Promise<TMessage[]>;
  /** Append one message. Resolves with a coded result — never throws to the UI. */
  send: (body: string) => Promise<TResult>;
  /** Where a send that fails is said. Required: the hook has no copy of its own. */
  refusals: ThreadSendRefusals<TResult>;
  /** The sender's own message as the thread shows it, used only when the re-read
   *  after a SUCCESSFUL send fails, so a saved message never vanishes from view.
   *  Without it, that failure shows THREAD_LOAD_FAILED instead of saying nothing. */
  echo?: (body: string) => TMessage;
}): DocumentThread<TMessage> {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<typeof THREAD_LOAD_FAILED | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  function fetchThread(): void {
    startLoading(async () => {
      // Wrap the await: a rejected read must surface as a coded error, never as an
      // unhandled rejection that leaves the panel spinning.
      try {
        setMessages(await options.load());
        setLoaded(true);
      } catch {
        setError(THREAD_LOAD_FAILED);
      }
    });
  }

  function toggle(): void {
    const next = !open;
    setOpen(next);
    setError(null);
    // Fetch until a read has completed; after that, re-opening reuses what we hold.
    if (next && !loaded && !loading) fetchThread();
  }

  /** After a successful send: re-read, or keep what is shown plus the sent message. */
  async function rereadAfterSend(body: string): Promise<void> {
    try {
      setMessages(await options.load());
      setLoaded(true);
    } catch {
      // The message WAS saved, so no send error. Keep what is on screen, add the
      // sender's own message (`partial` then says some may be missing), and let
      // the next open read the thread again.
      const echo = options.echo;
      if (echo) setMessages((shown) => [...shown, echo(body)]);
      else setError(THREAD_LOAD_FAILED);
      setLoaded(false);
    }
  }

  function send(): void {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    startSending(async () => {
      try {
        const result = await options.send(body);
        if (options.refusals.applyResult(result)) return;
        setDraft('');
        // Re-read rather than appending locally: the stored row carries the real
        // timestamp, and a refetch also surfaces anything the other side sent
        // while this message was being written.
        await rereadAfterSend(body);
      } catch (rejection) {
        options.refusals.applyRejection(rejection);
      }
    });
  }

  return {
    open,
    loaded,
    messages,
    partial: !loaded && !loading && messages.length > 0,
    draft,
    setDraft,
    error,
    loading,
    sending,
    toggle,
    send,
  };
}
