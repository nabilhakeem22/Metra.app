'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { FinalAccountView } from '@/lib/execution/final-account/load';
import { withinMagnitude } from '@/lib/money/read';
import { FinalAccountDifferences } from './final-account-differences';
import { IssueFinalAccountDialog } from './issue-final-account-dialog';
import { useFinalAccount } from './use-final-account';

type Blocked = 'notSigned' | 'terminated' | 'openVariations' | 'nothingDue' | 'tooLarge';

/** Why the final account cannot be issued now, or null when it can (the core's refusals, said first). */
function blockedReason(view: FinalAccountView): Blocked | null {
  if (view.status === 'terminated') return 'terminated';
  if (view.status !== 'signed') return 'notSigned';
  if (view.openVariationCount > 0) return 'openVariations';
  if (parseMoney4(view.figures.balance) <= 0n) return 'nothingDue';
  return withinMagnitude(view.figures.balance) ? null : 'tooLarge';
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-0">
      <dt className={strong ? 'font-semibold' : 'text-muted-foreground'}>{label}</dt>
      <dd dir="ltr" className={`whitespace-nowrap font-mono tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  );
}

/**
 * The final account (الحساب الختامي, plan A5.2): its figures, computed and
 * never stored; the issued final account request, or what stands in the way
 * of issuing it, or "Issue" for a role with `invoices_issue`; and the measured
 * differences behind it. Read on demand every time its tab is shown.
 */
export function FinalAccountCard({ contractId, canIssue, m }: { contractId: string; canIssue: boolean; m: (value: string) => string }) {
  const t = useTranslations('contracts.execution.finalAccount');
  const data = useFinalAccount(contractId);
  const { view, reload } = data;
  const [issuing, setIssuing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void reload();
  }, [reload]);

  const blocked = view && !view.issued ? blockedReason(view) : null;
  const openIssue = () => {
    setNotice(null);
    setIssuing(true);
  };

  return (
    <Card>
      <CardContent className="space-y-5 py-4">
        <div className="space-y-1">
          <h2 className="text-body font-semibold">{t('title')}</h2>
          <p className="text-caption text-muted-foreground">{t('intro')}</p>
        </div>
        {data.error && <p className="text-body text-destructive" role="alert">{data.error}</p>}
        {notice && <p className="text-body" role="status">{notice}</p>}
        {view === null ? (
          data.loading && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('loading')} />
        ) : (
          <>
            <dl className="max-w-xl text-body">
              <Figure label={t('originalValue')} value={m(view.originalValue)} />
              <Figure label={t('variationsCharge')} value={m(view.figures.variationsCharge)} />
              <Figure label={t('adjustmentWorks')} value={m(view.figures.adjustmentWorks)} />
              <Figure label={t('adjustmentCharge')} value={m(view.figures.adjustmentCharge)} />
              <Figure label={t('finalValue')} value={m(view.figures.finalValue)} strong />
              <Figure label={t('billedSoFar')} value={m(view.figures.billedSoFar)} />
              <Figure label={t('balance')} value={m(view.figures.balance)} strong />
            </dl>
            {view.issued && (
              <div className="space-y-1 rounded-item border border-[color:var(--rule)] p-3">
                <p className="text-body font-semibold">
                  {t('issued.title')} <span dir="ltr">{view.issued.documentNumber}</span>
                </p>
                <dl className="max-w-xl text-body">
                  <Figure label={t('issued.amount')} value={m(view.issued.amount)} />
                  <Figure label={t('issued.paid')} value={m(view.issued.paid)} />
                  <Figure label={t('issued.outstanding')} value={m(view.issued.outstanding)} strong />
                </dl>
                <p className="text-caption text-muted-foreground">{t('issued.note')}</p>
              </div>
            )}
            {blocked && <p className="text-body text-muted-foreground">{t(`blocked.${blocked}`, { count: String(view.openVariationCount) })}</p>}
            {!view.issued && blocked === null &&
              (canIssue ? (
                <Button variant="default" onClick={openIssue}>{t('issue.open')}</Button>
              ) : (
                <p className="text-body text-muted-foreground">{t('someoneElse')}</p>
              ))}
            <FinalAccountDifferences view={view} loading={data.loading} m={m} onShowMore={() => void data.showMoreDifferences()} />
            {issuing && (
              <IssueFinalAccountDialog
                contractId={contractId}
                amount={view.figures.balance}
                m={m}
                onAnswered={async (next) => {
                  if (!next) return reload();
                  data.apply(next);
                  if (next.issued) setNotice(t('issue.done'));
                  return next;
                }}
                onClose={() => setIssuing(false)}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
