'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import {
  revealDeliveryLink,
  revokeDeliveryLink,
  rotateDeliveryLink,
  shareDeliveryLink,
} from '@/lib/engagements/actions';
import {
  DELIVERY_LINK_CHANGED_EVENT,
  announceDeliveryLinkChanged,
  type DeliveryLinkChange,
} from './share-anchor';

/**
 * The state of the cockpit's client-link dialog (`open`), the three writes that
 * change the link, and `reveal`, which shows the link the client ALREADY holds.
 *
 * Only the token's sha256 hash and a nonce are stored (share.ts); the token IS
 * the client's authentication, so it is never kept in plaintext. Round B (B11):
 * it is re-derived from the nonce under the Worker secret, so "show me the link
 * again" no longer has to rotate it. A link minted before that answers
 * `delivery_link_unrecoverable`, and the dialog points at the one way out:
 * Replace the link.
 *
 * IT FOLLOWS THE LINK, not its first render: the server's `initialShared`
 * after every refresh, and the reminder dialog's own replace or share
 * (DELIVERY_LINK_CHANGED_EVENT), which also drops a revealed link that may be
 * dead now.
 */
export interface DeliveryShareApi {
  pending: boolean;
  shared: boolean;
  /** The raw link, after mint/rotate/reveal. Cleared on revoke. */
  link: string | null;
  copied: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  error: string | null;
  share: () => void;
  /** Show the existing link again. Never rotates. */
  reveal: () => void;
  rotate: () => void;
  revoke: () => void;
  copy: () => void;
}

type ShareResult = { ok: boolean; error?: string; link?: string };

export function useDeliveryShare(options: {
  engagementId: string;
  initialShared: boolean;
}): DeliveryShareApi {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shared, setShared] = useState(options.initialShared);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // The server's answer after a refresh is the truth about whether a link exists.
  useEffect(() => {
    setShared(options.initialShared);
  }, [options.initialShared]);

  // The reminder dialog replaced or shared the link: what this dialog showed is stale.
  useEffect(() => {
    const onChanged = (event: Event) => {
      const change = (event as CustomEvent<DeliveryLinkChange>).detail;
      if (!change || change.source === 'clientLink') return;
      setShared(change.shared);
      setLink(null);
      setCopied(false);
      setError(null);
    };
    window.addEventListener(DELIVERY_LINK_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(DELIVERY_LINK_CHANGED_EVENT, onChanged);
  }, []);

  /**
   * Run one link action. `sharedAfter`: the link state a WRITE leaves behind,
   * announced to the reminder dialog and re-read from the server; undefined
   * for a read (reveal).
   */
  function run(
    action: () => Promise<ShareResult>,
    onOk: (link?: string) => void,
    sharedAfter?: boolean,
  ): void {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      // Wrapped: a rejected action must surface as an error, never a stuck spinner.
      let result: ShareResult;
      try {
        result = await action();
      } catch {
        result = { ok: false, error: 'generic' };
      }
      if (result.ok) {
        onOk(result.link);
        if (sharedAfter !== undefined) {
          announceDeliveryLinkChanged({ shared: sharedAfter, source: 'clientLink' });
          router.refresh();
        }
      } else if (result.error === 'delivery_link_not_shared') {
        // Revoked elsewhere since this page loaded: say what is true now.
        setShared(false);
        setLink(null);
      } else {
        setError(result.error ?? 'generic');
        // A refusal belongs on screen, not behind a closed dialog.
        setOpen(true);
      }
    });
  }

  /** A revealed token behind a closed dialog would be lost, so a reveal always opens it. */
  function reveal(revealed?: string): void {
    setLink(revealed ?? null);
    setOpen(true);
  }

  return {
    pending,
    shared,
    link,
    copied,
    open,
    setOpen,
    error,
    share: () =>
      run(
        () => shareDeliveryLink(options.engagementId),
        (revealed) => {
          setShared(true);
          reveal(revealed);
        },
        true,
      ),
    reveal: () => run(() => revealDeliveryLink(options.engagementId), reveal),
    rotate: () => run(() => rotateDeliveryLink(options.engagementId), reveal, true),
    revoke: () =>
      run(
        () => revokeDeliveryLink(options.engagementId),
        () => {
          setShared(false);
          setLink(null);
        },
        false,
      ),
    copy: () => {
      if (!link) return;
      navigator.clipboard?.writeText(link);
      setCopied(true);
    },
  };
}
