'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import { checkPaymentAttempt } from '@/lib/execution/payments/actions';
import type { PaymentAttempt } from './use-payment-attempt';

/**
 * Said in the record dialog when a DIFFERENT payment is about to be recorded
 * on a request whose earlier attempt never got an answer (A4 F1, N1): that one
 * may be in the ledger already. "Check the payments" asks the server, behind
 * the request's row lock (check-attempt.ts), whether it landed, and re-reads
 * the tab. The key is released, and the dialog closed on the fresh ledger, only
 * when that answer settles the earlier attempt: it landed, or it was sent long
 * enough ago that it cannot still be running (PAYMENT_WRITE_WINDOW_MS). Inside
 * that window "not there" may mean "not yet", so the studio is asked to check
 * again in a moment; a check that could not answer keeps the key too.
 */
export function PreviousAttemptNotice({
  contractId,
  requestId,
  attempt,
  onAnswered,
  onAlreadyRecorded,
  onClose,
}: {
  contractId: string;
  requestId: string;
  attempt: PaymentAttempt;
  onAnswered: (view?: ContractBillingView) => unknown;
  onAlreadyRecorded: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('contracts.execution.payments.record');
  const [said, setSaid] = useState<'checkFailed' | 'stillRunning' | null>(null);
  const [pending, startTransition] = useTransition();

  function check() {
    const held = attempt.held();
    if (!held) return onClose();
    setSaid(null);
    startTransition(async () => {
      try {
        const res = await checkPaymentAttempt({ requestId, idempotencyKey: held.key }, { contractId });
        onAnswered(res.ok ? res.view : undefined);
        if (!res.ok) return setSaid('checkFailed');
        const landed = res.data?.landed === true;
        if (!landed && attempt.mayStillBeRunning()) return setSaid('stillRunning');
        // Settled: it is in the ledger the tab now shows, or it can no longer land.
        attempt.forget();
        if (landed) onAlreadyRecorded();
        onClose();
      } catch {
        onAnswered();
        setSaid('checkFailed');
      }
    });
  }

  return (
    <div data-previous-attempt className="space-y-2 rounded-item border border-[color:var(--warn)] p-3" role="status">
      <p className="text-body">{t('previousAttempt')}</p>
      {said && <p className="text-body font-medium">{t(said)}</p>}
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={check}>
        {t('checkPayments')}
      </Button>
    </div>
  );
}
