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
import type { BoqStepCompletion } from '@/lib/engagements/boq-step-complete';
import { formatMoney } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import type { SaveDraftResult } from './persist-draft';
import { buildProposalPayload, type ProposalDraftState } from './proposal-payload';

/** Left-to-right isolate, so a money figure reads the same inside Arabic text. */
const isolateLtr = (text: string) => `⁦${text}⁩`;

/**
 * Outcomes after which the studio cannot know what was sent: the send may have
 * issued a BOQ (`uncertain`), another send or edit won the race
 * (`boq_send_conflict`), or the action never answered (a throw). Retrying from
 * here could issue a second version, so these go back to the delivery, freshly
 * read, where the BOQ step shows what actually exists.
 */
const UNKNOWN_OUTCOME: ReadonlySet<ActionCode | undefined> = new Set<ActionCode | undefined>([
  'uncertain',
  'boq_send_conflict',
]);

/**
 * The toast after a send, by what became of the delivery's BOQ step: done, or
 * waiting for the finance roles (owner decision Q1). Not at the step (a later
 * version) or a failed move says only that the BOQ went out.
 */
const SENT_TOAST: Record<BoqStepCompletion, 'sent' | 'sentStepDone' | 'sentStepWaits'> = {
  completed: 'sentStepDone',
  not_permitted: 'sentStepWaits',
  not_at_boq: 'sent',
  failed: 'sent',
};

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
  /** Store the latest edits (the autosave's flush); answers like a save. */
  flush: () => Promise<SaveDraftResult>;
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

  const showRealState = (): void => {
    router.refresh();
    router.push(`/engagements/${options.engagementId}`);
  };

  /** The send itself, once the draft is saved. Never throws. */
  async function sendSaved(): Promise<void> {
    let sent: Awaited<ReturnType<typeof sendProposalAsBoq>>;
    try {
      sent = await sendProposalAsBoq(options.proposalId);
    } catch {
      refuse('generic');
      showRealState();
      return;
    }
    if (sent.ok && sent.data) {
      toast({ title: t(SENT_TOAST[sent.data.boqStep], { documentNumber: sent.data.documentNumber }) });
      router.push(`/engagements/${options.engagementId}`);
      return;
    }
    refuse(sent.error);
    if (UNKNOWN_OUTCOME.has(sent.error)) showRealState();
  }

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
      // A save that fails or throws keeps the studio on its draft: nothing was
      // sent, and leaving would drop edits that may not be stored.
      try {
        const saved = await options.flush();
        if (!saved.ok) {
          refuse(saved.error);
          return;
        }
      } catch {
        refuse('generic');
        return;
      }
      await sendSaved();
    });
  }

  return { send, pending };
}
