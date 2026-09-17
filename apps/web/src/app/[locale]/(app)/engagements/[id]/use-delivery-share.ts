'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import {
  revokeDeliveryLink,
  rotateDeliveryLink,
  shareDeliveryLink,
} from '@/lib/engagements/actions';
import { DELIVERY_SHARE_ANCHOR_ID, DELIVERY_SHARE_OPEN_EVENT } from './share-anchor';

/**
 * The state of the cockpit's "share with client" control, and the three writes
 * that change it.
 *
 * THE RAW TOKEN IS SHOWN ONCE AND IS THEN UNRECOVERABLE. Only its sha256 hash is
 * persisted (share.ts) — for this portal the token IS the client's
 * authentication, so keeping the plaintext would mean a database read, a backup,
 * or a leaked dump hands someone the client's delivery. That is why the answer to
 * "show me the link again" has to be a NEW link rather than the old one.
 */
export interface DeliveryShareApi {
  pending: boolean;
  shared: boolean;
  /** The raw link, revealed ONCE right after mint/rotate. Cleared on revoke. */
  link: string | null;
  copied: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  error: string | null;
  share: () => void;
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

  // The command card's "reveal the client link" scrolls here and asks to open.
  // Both sides name the SAME two constants, from share-anchor.ts — which is also
  // where `revealDeliveryShareLink` (the dispatcher) lives, so a rename cannot
  // leave this listener subscribed to a string nobody fires.
  useEffect(() => {
    const anchor = document.getElementById(DELIVERY_SHARE_ANCHOR_ID);
    if (!anchor) return;
    const onOpen = () => setOpen(true);
    anchor.addEventListener(DELIVERY_SHARE_OPEN_EVENT, onOpen);
    return () => anchor.removeEventListener(DELIVERY_SHARE_OPEN_EVENT, onOpen);
  }, []);

  function run(
    action: () => Promise<ShareResult>,
    onOk: (link?: string) => void,
  ): void {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        onOk(result.link);
        router.refresh();
      } else {
        setError(result.error ?? 'generic');
        // A refusal belongs on screen, not folded away behind a closed row.
        setOpen(true);
      }
    });
  }

  /** A freshly revealed token inside a closed box is the one state where folding
   *  actually costs the studio something, so a reveal always opens. */
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
