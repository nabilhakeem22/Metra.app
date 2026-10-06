'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import { confirmPaymentClaim, dismissPaymentClaim } from '@/lib/engagements/actions';
import { claimAdvancesTo } from '@/lib/engagements/claim-advance';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type { EngagementPaymentClaimRecord } from '@/lib/engagements/queries';
import { formatMoney } from '@/lib/format/money';
import type { RunAction } from './use-engagement-action';

/** Strip trailing scale-4 zeros for a clean, editable pre-fill ("30000.0000" -> "30000"). */
function editablePrefill(scale4: string): string {
  return scale4.includes('.') ? scale4.replace(/\.?0+$/, '') : scale4;
}

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
  const tk = useTranslations('engagements.paymentKind');
  const tcmd = useTranslations('engagements.command');
  const tstate = useTranslations('engagements.state');
  const te = useTranslations('errors');
  const locale = useLocale();
  const { confirm, dialog } = useConfirm();
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(claims.map((claim) => [claim.id, editablePrefill(claim.claimedAmount)])),
  );

  /** Confirm one claim. When it would also change the stage, say so and ask first. */
  async function confirmClaim(claim: EngagementPaymentClaimRecord): Promise<void> {
    const amount = (amounts[claim.id] ?? '').trim();
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
    runAction(async () => {
      const res = await confirmPaymentClaim({ claimId: claim.id, amount });
      // The payment is recorded even when the delivery could not move yet: say so,
      // and name what it is still waiting for, rather than raising an error.
      if (res.ok) {
        toast({
          title: tcmd('claim.recorded'),
          description:
            !res.advanced && res.waitingOn ? resolveActionError(res.waitingOn, te) : undefined,
        });
      }
      return res;
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {claims.map((claim, index) => (
          <li
            key={claim.id}
            className="space-y-2 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-body font-medium">{tk(claim.milestoneKind)}</span>
              <span dir="ltr" className="text-body tabular-nums text-[color:var(--text-muted)]">
                {formatMoney(claim.claimedAmount, locale)}
              </span>
            </div>
            {claim.actorName && (
              <p className="text-caption text-[color:var(--text-muted)]">
                {t('claimedBy', { name: claim.actorName })}
              </p>
            )}
            {claim.note && <p className="text-caption text-[color:var(--text-muted)]">{claim.note}</p>}
            <div className="space-y-1.5">
              <Label htmlFor={`claim-amount-${claim.id}`}>{t('amount')}</Label>
              <Input
                id={`claim-amount-${claim.id}`}
                dir="ltr"
                inputMode="decimal"
                className="tabular-nums"
                value={amounts[claim.id] ?? ''}
                onChange={(event) =>
                  setAmounts((prev) => ({ ...prev, [claim.id]: event.target.value }))
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
                type="button"
                // One primary anchor per page: the first claim's confirm.
                data-primary-action={index === 0 ? '' : undefined}
                disabled={pending}
                onClick={() => void confirmClaim(claim)}
              >
                {t('confirm')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => runAction(() => dismissPaymentClaim({ claimId: claim.id }))}
              >
                {t('dismiss')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-small text-[color:var(--text-muted)]">{tcmd('claim.note')}</p>
      {dialog}
    </div>
  );
}
