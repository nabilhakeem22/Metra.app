'use client';

import { useTranslations } from 'next-intl';
import type { PortalPaymentDetails } from '@/lib/engagements/public/types';
import { CopyValueRow } from './copy-value-row';

/** The rows in the order a client pays: the quick way first, then the bank's. */
const ROWS = [
  ['instapay', 'instapay'],
  ['bankName', 'bankName'],
  ['bankAccountHolder', 'accountHolder'],
  ['bankAccountNumber', 'accountNumber'],
  ['bankIban', 'iban'],
] as const satisfies ReadonlyArray<readonly [keyof PortalPaymentDetails, string]>;

/**
 * "How to pay": the studio's own InstaPay address and bank details, each as
 * plain text with a Copy button. The InstaPay address is NEVER a link (the
 * studio typed it; a link would be a phishing surface on a page that asks the
 * client for money). Rendered only while a payment is due and unclaimed (the
 * caller decides; the server already sends no details otherwise).
 */
export function PaymentInstructions({ details }: { details: PortalPaymentDetails }) {
  const t = useTranslations('delivery.payments.instructions');
  return (
    <section aria-labelledby="payment-instructions-title" className="rounded-item border p-3">
      <h3 id="payment-instructions-title" className="text-body font-semibold">
        {t('title')}
      </h3>
      <p className="mb-1 text-caption text-muted-foreground">{t('body')}</p>
      {ROWS.map(([field, labelKey]) => {
        const value = details[field];
        return value ? <CopyValueRow key={field} label={t(labelKey)} value={value} /> : null;
      })}
    </section>
  );
}
