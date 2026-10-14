'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { getProposalPreviewHtml } from '@/lib/proposals/actions';

export type PreviewVariant = 'client' | 'internal';

/**
 * The preview's HTML for one variant, fetched while the modal is open. The
 * internal copy comes through the margin-gated action, so a non-privileged
 * caller can never pull cost figures. A refusal or a rejected action toasts and
 * always clears the spinner.
 */
export function usePreviewHtml(
  proposalId: string,
  open: boolean,
  variant: PreviewVariant,
): { html: string | null; loading: boolean } {
  const te = useTranslations('errors');
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (v: PreviewVariant) => {
      setLoading(true);
      setHtml(null);
      try {
        const res = await getProposalPreviewHtml(proposalId, v);
        if (res.ok && res.html) {
          setHtml(res.html);
        } else {
          toast({ title: describeFailure(res, te), variant: 'destructive' });
        }
      } catch (rejection) {
        // Never leave the spinner hanging if the action rejects.
        toast({ title: describeRejection(rejection, te), variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    },
    [proposalId, te],
  );

  useEffect(() => {
    if (open) void load(variant);
  }, [open, variant, load]);

  return { html, loading };
}
