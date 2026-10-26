'use client';

import { useTranslations } from 'next-intl';
import type { PortalPaymentDetails } from '@/lib/engagements/public/types';
import type { PhaseKey } from '@/lib/flow/types';
import { CopyValueRow } from './copy-value-row';

/**
 * The rows in the order a client pays: the quick way first, then the bank's.
 * The third column says whether the value is a figure (set in the mono face,
 * left to right) or a name (set in the page's face, where Arabic letters join).
 */
const ROWS = [
  ['instapay', 'instapay', true],
  ['bankName', 'bankName', false],
  ['bankAccountHolder', 'accountHolder', false],
  ['bankAccountNumber', 'accountNumber', true],
  ['bankIban', 'iban', true],
] as const satisfies ReadonlyArray<readonly [keyof PortalPaymentDetails, string, boolean]>;

/**
 * "How to pay": the studio's own InstaPay address and bank details, each as
 * plain text with a Copy button. The InstaPay address is NEVER a link (the
 * studio typed it; a link would be a phishing surface on a page that asks the
 * client for money). Rendered only while a payment is due and unclaimed (the
 * caller decides; the server already sends no details otherwise). Who to tell
 * is said in the words of the phase being paid for.
 */
export function PaymentInstructions({ details, phase }: { details: PortalPaymentDetails; phase: PhaseKey }) {
  const t = useTranslations('delivery.payments.instructions');
  return (
    <section aria-labelledby="payment-instructions-title" className="rounded-item border p-3">
      <h3 id="payment-instructions-title" className="text-body font-semibold">
        {t('title')}
      </h3>
      <p className="mb-1 text-caption text-muted-foreground">{t(`body.${phase}`)}</p>
      {ROWS.map(([field, labelKey, figure]) => {
        const value = details[field];
        return value ? <CopyValueRow key={field} label={t(labelKey)} value={value} figure={figure} /> : null;
      })}
    </section>
  );
}
