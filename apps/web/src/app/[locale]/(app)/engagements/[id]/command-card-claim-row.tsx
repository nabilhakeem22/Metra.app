'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { dismissPaymentClaim } from '@/lib/engagements/actions';
import { paymentFieldErrors } from '@/lib/engagements/payment-field-rules';
import type { EngagementPaymentClaimRecord } from '@/lib/engagements/queries';
import { formatMoney } from '@/lib/format/money';
import { FormRefusal } from './form-refusal';
import type { RefusalSink, RunAction } from './run-action';

/** The claim row renders the confirmed amount; anything else is said above its buttons. */
const CLAIM_FIELDS = ['amount'] as const;

/** Strip trailing scale-4 zeros for a clean, editable pre-fill ("30000.0000" -> "30000"). */
function editablePrefill(scale4: string): string {
  return scale4.includes('.') ? scale4.replace(/\.?0+$/, '') : scale4;
}

/**
 * ONE pending claim: who claimed what, the amount to confirm (pre-filled from
 * the claim, EDITABLE so the studio can correct it), Confirm and Dismiss. Its
 * amount is checked before anything is asked or sent, and a refusal of it is
 * said under the box; each claim keeps its own refusals.
 */
export function CommandCardClaimRow({
  claim,
  primary,
  pending,
  runAction,
  onConfirm,
}: {
  claim: EngagementPaymentClaimRecord;
  /** One primary anchor per page: the first claim's confirm. */
  primary: boolean;
  pending: boolean;
  runAction: RunAction;
  onConfirm: (claim: EngagementPaymentClaimRecord, amount: string, form: RefusalSink) => void;
}) {
  const t = useTranslations('engagements.paymentClaims');
  const tk = useTranslations('engagements.paymentKind');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [amount, setAmount] = useState(() => editablePrefill(claim.claimedAmount));
  const errors = useFieldErrors({ fields: CLAIM_FIELDS, translate: te });
  const rowRef = useRef<HTMLLIElement>(null);
  useFocusFirstInvalid(rowRef, errors.invalidAttempt);

  function confirmClaim() {
    if (errors.applyLocal(paymentFieldErrors({ amount }))) return;
    onConfirm(claim, amount.trim(), errors);
  }

  return (
    <li
      ref={rowRef}
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
      <FormField id={`claim-amount-${claim.id}`} label={t('amount')} {...errors.bind('amount')}>
        <Input
          dir="ltr"
          inputMode="decimal"
          className="tabular-nums"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </FormField>
      <FormRefusal message={errors.formError} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="default"
          type="button"
          data-primary-action={primary ? '' : undefined}
          disabled={pending}
          onClick={confirmClaim}
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
  );
}
