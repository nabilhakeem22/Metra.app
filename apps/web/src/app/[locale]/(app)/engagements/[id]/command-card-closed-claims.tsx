'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { dismissPaymentClaim } from '@/lib/engagements/actions';
import type { EngagementPaymentClaimRecord } from '@/lib/engagements/queries';
import { formatMoney } from '@/lib/format/money';
import type { RunAction } from './use-engagement-action';

/**
 * A client payment claim still pending on a CLOSED delivery. The payment can no
 * longer be recorded (the ledger refuses a finished engagement), so the one
 * thing left is to dismiss the claim: the existing dismiss action, which writes
 * no ledger row and works whatever state the delivery is in. Without this the
 * claim had no way off the page once the delivery closed.
 */
export function CommandCardClosedClaims({
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
  const locale = useLocale();
  if (claims.length === 0) return null;
  return (
    <div className="mt-4 space-y-2 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-3">
      <p className="text-small font-semibold">{t('closedTitle')}</p>
      <p className="text-small text-[color:var(--text-muted)]">{t('closedHint')}</p>
      <ul className="space-y-2">
        {claims.map((claim) => (
          <li key={claim.id} className="flex flex-wrap items-center gap-2">
            <span className="text-body">{tk(claim.milestoneKind)}</span>
            <span dir="ltr" className="text-body tabular-nums text-[color:var(--text-muted)]">
              {formatMoney(claim.claimedAmount, locale)}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="ms-auto"
              disabled={pending}
              onClick={() => runAction(() => dismissPaymentClaim({ claimId: claim.id }))}
            >
              {t('dismiss')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
