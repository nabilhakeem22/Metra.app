'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  deleteDraftProposal,
  saveProposalDraft,
  sendProposal,
} from '@/lib/proposals/actions';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

// EVERY server write the proposal builder makes, and every toast it raises.

export interface BuilderActionsApi {
  pending: boolean;
  /** The share link, once the proposal has been sent. Null until then. */
  link: string | null;
  save: () => void;
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

type SaveResult = Awaited<ReturnType<typeof saveProposalDraft>>;

/** The draft, as the server takes it. The cast is the action's own input type. */
function persist(state: ProposalDraftState): Promise<SaveResult> {
  return saveProposalDraft(
    buildProposalPayload(state) as Parameters<typeof saveProposalDraft>[0],
  );
}

export function useBuilderActions(options: {
  draftState: () => ProposalDraftState;
  proposalId: string;
  confirm: ConfirmFn;
}): BuilderActionsApi {
  const t = useTranslations('proposals');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);

  const refuse = (code: ActionCode | undefined) =>
    toast({ title: resolveActionError(code, te), variant: 'destructive' });

  function save(): void {
    startTransition(async () => {
      const result = await persist(options.draftState());
      if (result.ok) toast({ title: t('toast.saved') });
      else refuse(result.error as ActionCode);
    });
  }

  /** SAVE THEN SEND, in one transition: sending a draft that was never saved
   *  would mail the client the version before the studio's last edit. */
  function onSend(): void {
    startTransition(async () => {
      const saved = await persist(options.draftState());
      if (!saved.ok) {
        refuse(saved.error as ActionCode);
        return;
      }
      const result = await sendProposal(options.proposalId);
      if (result.ok && result.link) {
        setLink(result.link);
        toast({ title: t('toast.sent') });
      } else {
        refuse(result.error as ActionCode);
      }
    });
  }

  async function onDelete(): Promise<void> {
    const confirmed = await options.confirm({
      title: t('actions.delete'),
      description: t('builder.delete'),
      confirmLabel: t('actions.delete'),
      cancelLabel: t('create.cancel'),
      variant: 'destructive',
    });
    if (!confirmed) return;
    startTransition(async () => {
      const result = await deleteDraftProposal(options.proposalId);
      if (result.ok) {
        toast({ title: t('toast.deleted') });
        router.push('/proposals');
      } else {
        refuse(result.error as ActionCode);
      }
    });
  }

  return { pending, link, save, onSend, onDelete };
}
