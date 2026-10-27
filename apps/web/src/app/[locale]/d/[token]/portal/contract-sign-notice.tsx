'use client';

import { useTranslations } from 'next-intl';
import { describeSignFailure } from './contract-sign-failure';
import type { SignNotice } from './use-contract-signing';

/**
 * What the contract section says after the client's signing was answered:
 * that it is signed and the studio told, that it already was, or why it was
 * not (the window closed, the contract moved on, a shared portal failure).
 * Kept by the section, so it still stands once the page, read again, no
 * longer shows the signing. فصحى copy.
 */
export function ContractSignNotice({ notice, studio }: { notice: SignNotice | null; studio: string }) {
  const t = useTranslations('delivery.contract.sign');
  const tErrors = useTranslations('portal.errors');
  if (!notice) return null;
  if (notice.kind !== 'refused') {
    return (
      <p role="status" className="rounded-item bg-muted/50 p-3 text-body font-medium" data-sign-notice={notice.kind}>
        {t(notice.kind, { studio })}
      </p>
    );
  }
  return (
    <p role="alert" className="text-body text-destructive" data-sign-notice={notice.failure.error}>
      {describeSignFailure(notice.failure, tErrors, (key) => t(key, { studio }))}
    </p>
  );
}
