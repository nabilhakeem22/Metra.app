'use client';

import { useState, useTransition } from 'react';

/**
 * Client Deliverables, Step 2 — the state machine BEHIND a document comment thread,
 * shared by the client portal and the studio cockpit so the two can never drift.
 *
 * Headless on purpose. The two surfaces have genuinely different design systems
 * (the portal uses shadcn semantic classes, the cockpit uses Metra's `--token`
 * palette) and different server actions, so their MARKUP is legitimately separate.
 * Their behaviour is not: both are collapsed-by-default, both fetch lazily on the
 * first open only, both re-read after a send rather than appending locally, and both
 * wrap the await so a rejected action can never strand the spinner. That behaviour
 * lives here, once.
 *
 * Generic over the message type because the two readers return different shapes —
 * the client sees no staff identity, the studio sees author ids — and neither should
 * be widened to accommodate the other.
 */
export interface DocumentThread<TMessage> {
  /** Is the thread expanded? */
  open: boolean;
  /** Has a fetch actually completed? Distinguishes "empty" from "not yet loaded". */
  loaded: boolean;
  messages: TMessage[];
  draft: string;
  setDraft: (value: string) => void;
  /** A coded error for the caller to localize, or null. */
  error: string | null;
  /** A first load is in flight. */
  loading: boolean;
  /** A send is in flight. */
  sending: boolean;
  /** Expand/collapse, fetching on the FIRST expand only. */
  toggle: () => void;
  /** Send the trimmed draft, then re-read. No-op on a blank draft. */
  send: () => void;
}

export function useDocumentThread<TMessage>(options: {
  /** Read the thread. Must resolve to `[]` rather than throwing on a miss. */
  load: () => Promise<TMessage[]>;
  /** Append one message. Resolves with a coded result — never throws to the UI. */
  send: (body: string) => Promise<{ ok: boolean; error?: string }>;
}): DocumentThread<TMessage> {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<TMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
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
        setError('generic');
      }
    });
  }

  function toggle(): void {
    const next = !open;
    setOpen(next);
    setError(null);
    // Fetch on the FIRST open only; re-opening reuses what we already hold.
    if (next && !loaded && !loading) fetchThread();
  }

  function send(): void {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    startSending(async () => {
      try {
        const result = await options.send(body);
        if (!result.ok) {
          setError(result.error ?? 'generic');
          return;
        }
        setDraft('');
        // Re-read rather than appending locally: the stored row carries the real
        // timestamp, and a refetch also surfaces anything the other side sent
        // while this message was being written.
        setMessages(await options.load());
        setLoaded(true);
      } catch {
        setError('generic');
      }
    });
  }

  return {
    open,
    loaded,
    messages,
    draft,
    setDraft,
    error,
    loading,
    sending,
    toggle,
    send,
  };
}
