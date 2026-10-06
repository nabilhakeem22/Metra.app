'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import {
  revokeDeliveryLink,
  rotateDeliveryLink,
  shareDeliveryLink,
} from '@/lib/engagements/actions';

/**
 * The state of the cockpit's client-link dialog (`open`), and the three writes
 * that change the link.
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
