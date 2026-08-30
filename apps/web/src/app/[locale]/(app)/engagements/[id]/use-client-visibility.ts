'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/hooks/use-toast';
import { setArtifactClientVisibility } from '@/lib/engagements/actions';

/**
 * Client Deliverables, Step 1 — the shared "show/hide on the client portal" toggle,
 * used by BOTH the working-files tray and the full artifact table so the two
 * surfaces can never drift.
 *
 * Optimistic and reload-free: the flipped value is held locally the moment the user
 * clicks, so the row updates instantly; a failed action reverts that row and toasts
 * the localized reason. There is deliberately NO `router.refresh()` — the studio can
 * flip several files in a row without the page reloading under them. The server
 * action is the real authorization gate; a hidden control is not a gate.
 */
export function useClientVisibility(): {
  /** The artifact currently being saved, or null. */
  savingId: string | null;
  /** The value to render for an artifact — the optimistic one if it has been
   *  toggled this session, otherwise the server's. */
  isVisible: (artifactId: string, serverValue: boolean) => boolean;
  toggle: (artifactId: string, next: boolean) => void;
} {
  const t = useTranslations('engagements.files.visibility');
  const [, startTransition] = useTransition();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  function isVisible(artifactId: string, serverValue: boolean): boolean {
    return artifactId in overrides ? overrides[artifactId] : serverValue;
  }

  function toggle(artifactId: string, next: boolean) {
    setOverrides((prev) => ({ ...prev, [artifactId]: next }));
    setSavingId(artifactId);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the row stuck saving.
      try {
        const result = await setArtifactClientVisibility({ artifactId, visible: next });
        if (!result.ok) {
          setOverrides((prev) => ({ ...prev, [artifactId]: !next }));
          toast({ title: t('error'), variant: 'destructive' });
        }
      } catch {
        setOverrides((prev) => ({ ...prev, [artifactId]: !next }));
        toast({ title: t('error'), variant: 'destructive' });
      } finally {
        setSavingId(null);
      }
    });
  }

  return { savingId, isVisible, toggle };
}
