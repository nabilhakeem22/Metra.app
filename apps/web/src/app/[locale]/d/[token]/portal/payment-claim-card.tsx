'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { PublicDelivery } from '@/lib/engagements/public';
import { formatMoney } from '@/lib/format/money';
import { markDeliveryPaymentPaid } from '../actions';

/** The milestone kinds the portal knows a bilingual label for. */
const KNOWN_KINDS = new Set(['deposit', 'gate_a', 'gate_b', 'balance']);

/**
 * Client Delivery Portal Phase 3 — the "mark as paid" surface. Renders the LIST of
 * claimable (unsettled) milestones the SDF computed. ANY unsettled milestone is
 * claimable (not just the next-due one). Each milestone without an open claim shows
 * a "mark as paid" CTA with its remaining amount (READ-ONLY — the client never
 * enters an amount; it is locked server-side); a milestone that already has a
 * pending claim shows a calm "recorded — pending studio confirmation" note instead.
 *
 * The claim is advisory: it moves no state and writes no money ledger. A repeat
 * resolves ok (idempotent). Money is rendered LTR with Western numerals. Renders
 * nothing when there is no claimable milestone. Mobile-first, RTL/LTR-safe.
 */
export function PaymentClaimCard({
  token,
  claim,
}: {
  token: string;
  claim: PublicDelivery['paymentClaim'];
}) {
  const t = useTranslations('delivery.claim');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  // Which milestone is currently submitting, and which have been confirmed this
  // session (a local optimistic flip so the client sees immediate feedback).
  const [submittingKind, setSubmittingKind] = useState<string | null>(null);
  const [confirmedKinds, setConfirmedKinds] = useState<Set<string>>(new Set());
  const [errorKind, setErrorKind] = useState<{ kind: string; code: string } | null>(
    null,
  );

  const milestones = claim?.claimableMilestones ?? [];
  if (milestones.length === 0) return null;

  function kindLabel(kind: string): string {
    return KNOWN_KINDS.has(kind) ? t(`kind.${kind}`) : kind;
  }

  function submit(kind: string) {
    setErrorKind(null);
    setSubmittingKind(kind);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const result = await markDeliveryPaymentPaid(token, kind);
        if (result.ok) {
          setConfirmedKinds((prev) => new Set(prev).add(kind));
        } else {
          setErrorKind({ kind, code: result.error ?? 'generic' });
        }
      } catch {
        setErrorKind({ kind, code: 'generic' });
      } finally {
        setSubmittingKind(null);
      }
    });
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <ul className="space-y-2">
        {milestones.map((milestone) => {
          const confirmed = confirmedKinds.has(milestone.milestoneKind);
          const showPending = milestone.hasPendingClaim || confirmed;
          const isSubmitting = pending && submittingKind === milestone.milestoneKind;
          const rowError =
            errorKind?.kind === milestone.milestoneKind ? errorKind.code : null;

          return (
            <li
              key={milestone.milestoneKind}
              className="flex flex-col gap-2 rounded-xl border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {kindLabel(milestone.milestoneKind)}
                </span>
                <span dir="ltr" className="text-sm font-semibold tabular-nums">
                  {formatMoney(milestone.amountRemaining, locale)}
                </span>
              </div>

              {showPending ? (
                <p className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                  {t('recordedPending')}
                </p>
              ) : (
                <>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => submit(milestone.milestoneKind)}
                  >
                    {isSubmitting && (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    )}
                    {t('markPaid')}
                  </Button>
                  {rowError && (
                    <p className="text-xs text-destructive" role="alert">
                      {t(`error.${rowError}`)}
                    </p>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
    </section>
  );
}
