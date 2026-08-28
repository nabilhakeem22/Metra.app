'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  confirmPaymentClaim,
  dismissPaymentClaim,
} from '@/lib/engagements/actions';
import type { EngagementPaymentClaimRecord } from '@/lib/engagements/queries';
import { formatMoney } from '@/lib/format/money';

/** Strip trailing scale-4 zeros for a clean, editable pre-fill ("30000.0000" -> "30000"). */
function editablePrefill(scale4: string): string {
  return scale4.includes('.') ? scale4.replace(/\.?0+$/, '') : scale4;
}

/**
 * Cockpit "payment claims" panel (Client Delivery Portal Phase 3). Lists the PENDING
 * client "mark as paid" claims and lets the studio CONFIRM (with a pre-filled but
 * EDITABLE amount — the studio may correct it) or DISMISS each. Confirm records the
 * real payment + flips the claim; dismiss writes no ledger row and frees the client
 * to re-submit. The parent page renders this only for `engagements_finance:create`
 * roles; the server action re-checks. Money is rendered LTR with Western numerals.
 * Bilingual, RTL/LTR-safe. Renders nothing when there are no pending claims.
 */
export function PaymentClaimsPanel({
  claims,
}: {
  claims: EngagementPaymentClaimRecord[];
}) {
  const t = useTranslations('engagements.paymentClaims');
  const tk = useTranslations('engagements.paymentKind');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      claims.map((claim) => [claim.id, editablePrefill(claim.claimedAmount)]),
    ),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; code: ActionCode } | null>(null);

  if (claims.length === 0) return null;

  function runFor(id: string, fn: () => Promise<{ ok: boolean; error?: ActionCode }>) {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) router.refresh();
        else setError({ id, code: res.error ?? 'generic' });
      } catch {
        setError({ id, code: 'generic' });
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <section className="space-y-3 rounded-[var(--r-item)] border border-amber-200 bg-amber-50/60 p-4">
      <h2 className="text-sm font-semibold text-amber-900">
        {t('title', { count: claims.length })}
      </h2>
      <ul className="space-y-3">
        {claims.map((claim) => {
          const rowError = error?.id === claim.id ? error.code : null;
          const isBusy = pending && busyId === claim.id;
          return (
            <li
              key={claim.id}
              className="space-y-2 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-background p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {tk(claim.milestoneKind)}
                </span>
                <span dir="ltr" className="text-sm text-muted-foreground tabular-nums">
                  {formatMoney(claim.claimedAmount, locale)}
                </span>
              </div>
              {claim.actorName && (
                <p className="text-xs text-muted-foreground">
                  {t('claimedBy', { name: claim.actorName })}
                </p>
              )}
              {claim.note && (
                <p className="text-xs text-muted-foreground">{claim.note}</p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={`claim-amount-${claim.id}`}>{t('amount')}</Label>
                <Input
                  id={`claim-amount-${claim.id}`}
                  dir="ltr"
                  inputMode="decimal"
                  className="tabular-nums"
                  value={amounts[claim.id] ?? ''}
                  onChange={(event) =>
                    setAmounts((prev) => ({
                      ...prev,
                      [claim.id]: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={pending}
                  onClick={() =>
                    runFor(claim.id, () =>
                      confirmPaymentClaim({
                        claimId: claim.id,
                        amount: (amounts[claim.id] ?? '').trim(),
                      }),
                    )
                  }
                >
                  {isBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {t('confirm')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    runFor(claim.id, () =>
                      dismissPaymentClaim({ claimId: claim.id }),
                    )
                  }
                >
                  {t('dismiss')}
                </Button>
              </div>
              {rowError && (
                <p className="text-xs text-destructive" role="alert">
                  {resolveActionError(rowError, te)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
