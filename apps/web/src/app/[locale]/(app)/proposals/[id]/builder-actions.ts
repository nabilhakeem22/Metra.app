'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';
import { deleteDraftProposal, sendProposal } from '@/lib/proposals/actions';
import type { SaveDraftResult } from './persist-draft';

// EVERY server write the proposal builder makes, and every toast it raises.

export interface BuilderActionsApi {
  pending: boolean;
  /** The share link, once the proposal has been sent. Null until then. */
  link: string | null;
  onSend: () => void;
  onDelete: () => Promise<void>;
}

type ConfirmFn = (options: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'destructive';
}) => Promise<boolean>;

export function useBuilderActions(options: {
  /** Store the latest edits (the autosave's flush); answers like a save. */
  flush: () => Promise<SaveDraftResult>;
  proposalId: string;
  confirm: ConfirmFn;
}): BuilderActionsApi {
  const t = useTranslations('proposals');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);

  const refuse = (result: Pick<ActionResult, 'error' | 'params' | 'reference'>) =>
    toast({ title: describeFailure(result, te), variant: 'destructive' });
  const unreachable = (rejection: unknown) =>
    toast({ title: describeRejection(rejection, te), variant: 'destructive' });

  /** SAVE THEN SEND, in one transition: sending a draft that was never saved
   *  would mail the client the version before the studio's last edit. */
  function onSend(): void {
    startTransition(async () => {
      try {
        const saved = await options.flush();
        if (!saved.ok) {
          refuse(saved);
          return;
        }
        const result = await sendProposal(options.proposalId);
        if (result.ok && result.link) {
          setLink(result.link);
          toast({ title: t('toast.sent') });
        } else {
          refuse(result);
        }
      } catch (rejection) {
        unreachable(rejection);
      }
    });
  }

  async function onDelete(): Promise<void> {
    const confirmed = await options.confirm({
      title: t('actions.delete'),
      description: t('builder.deleteBody'),
      confirmLabel: t('actions.delete'),
      cancelLabel: t('create.cancel'),
      variant: 'destructive',
    });
    if (!confirmed) return;
    startTransition(async () => {
      try {
        const result = await deleteDraftProposal(options.proposalId);
        if (result.ok) {
          toast({ title: t('toast.deleted') });
          router.push('/proposals');
        } else {
          refuse(result);
        }
      } catch (rejection) {
        unreachable(rejection);
      }
    });
  }

  return { pending, link, onSend, onDelete };
}
