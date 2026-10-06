'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { confirmPaymentClaim, dismissPaymentClaim } from '@/lib/engagements/actions';
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
  pending,
  runAction,
}: {
  claims: EngagementPaymentClaimRecord[];
  pending: boolean;
  runAction: RunAction;
}) {
  const t = useTranslations('engagements.paymentClaims');
  const tk = useTranslations('engagements.paymentKind');
  const tcmd = useTranslations('engagements.command');
  const locale = useLocale();
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(claims.map((claim) => [claim.id, editablePrefill(claim.claimedAmount)])),
  );

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {claims.map((claim) => (
          <li
            key={claim.id}
            className="space-y-2 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{tk(claim.milestoneKind)}</span>
              <span dir="ltr" className="text-sm tabular-nums text-[color:var(--text-muted)]">
                {formatMoney(claim.claimedAmount, locale)}
              </span>
            </div>
            {claim.actorName && (
              <p className="text-xs text-[color:var(--text-muted)]">
                {t('claimedBy', { name: claim.actorName })}
              </p>
            )}
            {claim.note && <p className="text-xs text-[color:var(--text-muted)]">{claim.note}</p>}
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
                type="button"
                disabled={pending}
                onClick={() =>
                  runAction(() =>
                    confirmPaymentClaim({
                      claimId: claim.id,
                      amount: (amounts[claim.id] ?? '').trim(),
                    }),
                  )
                }
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
      <p className="text-[12.5px] text-[color:var(--text-muted)]">{tcmd('claim.note')}</p>
    </div>
  );
}
