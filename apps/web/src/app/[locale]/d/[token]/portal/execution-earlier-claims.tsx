'use client';

import { Clock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PortalEarlierClaim } from '@/lib/engagements/public/execution-types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { DocumentNumber } from './document-number';
import { formatPortalMoney } from './portal-money';

/**
 * The client's "I paid" notices still waiting on an EARLIER contract of the
 * delivery (B4 F6). The card shows one contract, the live one first; a newer
 * contract must not hide a notice the studio has not answered yet. Nothing when
 * there is none.
 */
export function ExecutionEarlierClaims({ claims }: { claims: readonly PortalEarlierClaim[] }) {
  const t = useTranslations('delivery.execution.earlierClaims');
  const locale = useLocale();
  if (claims.length === 0) return null;

  return (
    <section aria-labelledby="execution-earlier-claims-title" className="space-y-1">
      <h3 id="execution-earlier-claims-title" className="text-caption font-semibold text-muted-foreground">
        {t('title')}
      </h3>
      <ul>
        {claims.map((claim) => (
          <li
            key={`${claim.requestNumber}-${claim.claimedAt}`}
            className="flex items-start gap-1.5 border-t py-2 text-caption text-muted-foreground first:border-t-0"
          >
            <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p className="min-w-0">
              {t.rich('row', {
                amount: bidiIsolate(formatPortalMoney(claim.amount, locale)),
                request: claim.requestNumber,
                date: bidiIsolate(formatDate(claim.claimedAt, locale)),
                num: (chunks) => <DocumentNumber>{chunks}</DocumentNumber>,
              })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
