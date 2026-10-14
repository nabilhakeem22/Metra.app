'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import { confirmPaymentClaim } from '@/lib/engagements/actions';
import { claimAdvancesTo } from '@/lib/engagements/claim-advance';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type { EngagementPaymentClaimRecord } from '@/lib/engagements/queries';
import { formatMoney } from '@/lib/format/money';
import { CommandCardClaimRow } from './command-card-claim-row';
import type { RefusalSink, RunAction } from './run-action';

/**
 * A pending client "mark as paid" claim is the card's ONE action. Confirm records
 * the real payment (amount pre-filled from the claim, EDITABLE so the studio can
 * correct it) and moves the delivery on when this is the payment its gate was
 * waiting for; Dismiss writes no ledger row and frees the client to re-submit.
 * The card offers this only to roles with `engagements_finance` create; the
 * server action re-checks. Money is LTR with Western numerals.
 */
export function CommandCardClaims({
  claims,
  preview,
  canAdvance,
  pending,
  runAction,
}: {
  claims: EngagementPaymentClaimRecord[];
  /** The gate, so a confirm that would ALSO move the delivery asks first. */
  preview: Pick<EngagementGatePreview, 'primaryTrigger' | 'items' | 'awaitingClientReview'>;
  canAdvance: boolean;
  pending: boolean;
  runAction: RunAction;
}) {
  const t = useTranslations('engagements.paymentClaims');
  const tcmd = useTranslations('engagements.command');
  const tstate = useTranslations('engagements.state');
  const te = useTranslations('errors');
  const locale = useLocale();
  const { confirm, dialog } = useConfirm();

  /** Confirm one claim. When it would also change the stage, say so and ask first. */
  async function confirmClaim(
    claim: EngagementPaymentClaimRecord,
    amount: string,
    form: RefusalSink,
  ): Promise<void> {
    const nextState = claimAdvancesTo(preview, claim.milestoneKind, amount, canAdvance);
    if (nextState) {
      const proceed = await confirm({
        title: tcmd('claim.advanceTitle', { amount: formatMoney(amount, locale) }),
        description: tcmd('claim.advanceBody', { phase: tstate(nextState) }),
        confirmLabel: t('confirm'),
        cancelLabel: tcmd('claim.cancel'),
      });
      if (!proceed) return;
    }
    runAction(
      async () => {
        const res = await confirmPaymentClaim({ claimId: claim.id, amount });
        // The payment is recorded even when the delivery could not move yet: say
        // so, and name what it is still waiting for, rather than raising an error.
        if (res.ok) {
          toast({
            title: tcmd('claim.recorded'),
            description:
              !res.advanced && res.waitingOn ? resolveActionError(res.waitingOn, te) : undefined,
          });
        }
        return res;
      },
      undefined,
      undefined,
      form,
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {claims.map((claim, index) => (
          <CommandCardClaimRow
            key={claim.id}
            claim={claim}
            primary={index === 0}
            pending={pending}
            runAction={runAction}
            onConfirm={(confirmed, amount, form) => void confirmClaim(confirmed, amount, form)}
          />
        ))}
      </ul>
      <p className="text-small text-[color:var(--text-muted)]">{tcmd('claim.note')}</p>
      {dialog}
    </div>
  );
}
