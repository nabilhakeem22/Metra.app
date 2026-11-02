'use client';

import { useTranslations } from 'next-intl';
import { bidiIsolate } from '@/lib/format/bidi';
import { describeDecideFailure } from './change-order-decide-failure';
import type { DecideNotice } from './use-change-order-decision';

/**
 * What the change orders section says after a decision was answered: that the
 * order is approved or rejected and the studio told, that a decision already
 * stood, or why not. It names the order, and the section keeps it, so it still
 * stands once the page, read again, no longer lists that order. فصحى copy.
 */
export function ChangeOrderNotice({ notice, number, studio }: { notice: DecideNotice; number: number; studio: string }) {
  const t = useTranslations('delivery.changeOrders.decide');
  const tErrors = useTranslations('portal.errors');
  const words = { number: bidiIsolate(String(number)), studio };
  if (notice.kind !== 'refused') {
    return (
      <p role="status" className="rounded-item bg-muted/50 p-3 text-body font-medium" data-decide-notice={notice.kind}>
        {t(notice.kind, words)}
      </p>
    );
  }
  return (
    <p role="alert" className="text-body text-destructive" data-decide-notice={notice.failure.error}>
      {describeDecideFailure(notice.failure, tErrors, (key) => t(key, words))}
    </p>
  );
}
