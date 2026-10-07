'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import {
  revealDeliveryLink,
  revokeDeliveryLink,
  rotateDeliveryLink,
  shareDeliveryLink,
} from '@/lib/engagements/actions';

/**
 * The state of the cockpit's client-link dialog (`open`), the three writes that
 * change the link, and `reveal`, which shows the link the client ALREADY holds.
 *
 * Only the token's sha256 hash and a nonce are stored (share.ts); the token IS
 * the client's authentication, so it is never kept in plaintext. Round B (B11):
 * it is re-derived from the nonce under the Worker secret, so "show me the link
 * again" no longer has to rotate it. A link minted before that (or without the
 * secret) answers `delivery_link_unrecoverable`, and the dialog points at the
 * one confirmed way out: Replace the link.
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

  /** Run one link action. `writes`: it changed the link, so the page re-reads. */
  function run(
    action: () => Promise<ShareResult>,
    onOk: (link?: string) => void,
    writes = true,
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
        if (writes) router.refresh();
      } else {
        setError(result.error ?? 'generic');
        // A refusal belongs on screen, not behind a closed dialog.
        setOpen(true);
      }
    });
  }

  /** A freshly revealed token behind a closed dialog is shown once and lost, so
   *  a reveal always opens it. */
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
      run(() => shareDeliveryLink(options.engagementId), (revealed) => {
        setShared(true);
        reveal(revealed);
      }),
    reveal: () => run(() => revealDeliveryLink(options.engagementId), reveal, false),
    rotate: () => run(() => rotateDeliveryLink(options.engagementId), reveal),
    revoke: () =>
      run(() => revokeDeliveryLink(options.engagementId), () => {
        setShared(false);
        setLink(null);
      }),
    copy: () => {
      if (!link) return;
      navigator.clipboard?.writeText(link);
      setCopied(true);
    },
  };
}
