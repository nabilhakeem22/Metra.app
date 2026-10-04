'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import type { ConfirmOptions } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { sendProposalAsBoq } from '@/lib/boq-proposals/actions';
import { countSendable } from '@/lib/boq-proposals/count';
import { formatMoney } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import { persistDraft } from './persist-draft';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

/** Left-to-right isolate, so a money figure reads the same inside Arabic text. */
const isolateLtr = (text: string) => `⁦${text}⁩`;

/**
 * "Send as BOQ": one confirmation that states what is being sent, then save
 * and send in one transition, then back to the delivery with the BQ number.
 *
 * The confirm is awaited OUTSIDE the transition: asking inside one deadlocks
 * (React holds the current UI while a transition is pending, so the dialog never
 * paints). Every await inside is wrapped so the spinner always clears.
 */
export function useSendAsBoq(options: {
  proposalId: string;
  engagementId: string;
  clientCanOpenNow: boolean;
  draftState: () => ProposalDraftState;
  totalBeforeVat: () => string;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}): { send: () => Promise<void>; pending: boolean } {
  const t = useTranslations('proposals.boqMode');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  const refuse = (code: ActionCode | undefined): void => {
    toast({ title: resolveActionError(code, te), variant: 'destructive' });
  };

  function summary(): string {
    const { lineCount, sectionCount } = countSendable(
      buildProposalPayload(options.draftState()).sections,
    );
    const figures = t('confirmSummary', {
      lineCount,
      lines: formatNumber(lineCount, locale),
      sectionCount,
      sections: formatNumber(sectionCount, locale),
      total: isolateLtr(formatMoney(options.totalBeforeVat(), locale)),
    });
    return `${figures} ${options.clientCanOpenNow ? t('gateOpen') : t('gateLocked')}`;
  }

  async function send(): Promise<void> {
    const confirmed = await options.confirm({
      title: t('confirmTitle'),
      description: summary(),
      confirmLabel: t('confirm'),
      cancelLabel: t('cancel'),
    });
    if (!confirmed) return;
    start(async () => {
      try {
        const saved = await persistDraft(options.draftState());
        if (!saved.ok) {
          refuse(saved.error);
          return;
        }
        const sent = await sendProposalAsBoq(options.proposalId);
        if (!sent.ok || !sent.data) {
          refuse(sent.error);
          return;
        }
        toast({ title: t('sent', { documentNumber: sent.data.documentNumber }) });
        router.push(`/engagements/${options.engagementId}`);
      } catch {
        refuse('generic');
      }
    });
  }

  return { send, pending };
}
