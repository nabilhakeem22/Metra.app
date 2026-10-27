'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ContractSigning } from '@/lib/contracts/queries/detail-types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';

/**
 * How a contract was signed, for the studio: the Cairo day and the way, and
 * for an online signature the name the client typed (H6.2 functional F4),
 * kept in its own direction inside the sentence. On the contract page and in
 * the delivery cockpit. Studio copy (Egyptian Arabic), Latin digits.
 */
export function ContractSigningLine({ signed, className }: { signed: ContractSigning; className?: string }) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const date = formatDate(signed.on, locale);
  return (
    <span className={className} data-contract-signed={signed.via}>
      {signed.signerName
        ? t('signedOnBy', { date, name: bidiIsolate(signed.signerName) })
        : t('signedOn', { date, via: signed.via })}
    </span>
  );
}
