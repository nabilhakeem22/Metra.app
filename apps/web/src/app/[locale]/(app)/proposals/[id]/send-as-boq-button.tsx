'use client';

import { Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ConfirmOptions } from '@/components/ui/confirm-dialog';
import type { ProposalDraftState } from './proposal-payload';
import { useSendAsBoq } from './use-send-as-boq';

/** The BOQ-mode primary action. Nothing to send means nothing to press. */
export function SendAsBoqButton({
  proposalId,
  engagementId,
  clientCanOpenNow,
  lineCount,
  draftState,
  totalBeforeVat,
  confirm,
}: {
  proposalId: string;
  engagementId: string;
  clientCanOpenNow: boolean;
  lineCount: number;
  draftState: () => ProposalDraftState;
  totalBeforeVat: () => string;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const t = useTranslations('proposals.boqMode');
  const { send, pending } = useSendAsBoq({
    proposalId,
    engagementId,
    clientCanOpenNow,
    draftState,
    totalBeforeVat,
    confirm,
  });
  return (
    <Button onClick={() => void send()} disabled={pending || lineCount === 0}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Send className="size-4" aria-hidden />
      )}
      {t('send')}
    </Button>
  );
}
