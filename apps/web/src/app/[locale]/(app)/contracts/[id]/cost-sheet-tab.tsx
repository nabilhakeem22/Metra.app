'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { loadCostSheet } from '@/lib/execution/cost-sheet/actions';
import type { CostSheet } from '@/lib/execution/money/cost-sheet-types';
import { formatPercent } from '@/lib/format/number';
import { CostSheetRows } from './cost-sheet-rows';

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd dir="ltr" className="font-mono text-body font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The cost sheet (كشف التكلفة, plan A5.3): the contract's value, what was
 * requested and paid, budget against actual cost per section, and the margin
 * (planned, and projected per section) for a role that may see margin; the
 * server leaves it out otherwise. Read on demand when the tab is shown: SQL
 * aggregates, so it costs the same however many costs the contract holds.
 */
export function CostSheetTab({ contractId, m }: { contractId: string; m: (value: string) => string }) {
  const t = useTranslations('contracts.execution.costSheet');
  const locale = useLocale();
  const te = useTranslations('errors');
  const [sheet, setSheet] = useState<CostSheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let shown = true;
    loadCostSheet({ contractId }).then(
      (res) => {
        if (!shown) return;
        if (res.ok && res.data) setSheet(res.data);
        else setError(describeFailure(res, te));
      },
      (rejection: unknown) => shown && setError(describeRejection(rejection, te)),
    );
    return () => {
      shown = false;
    };
  }, [contractId, te]);

  const pct = (value: number | null) => (value === null ? '' : ` (${formatPercent(value, locale)})`);

  return (
    <Card>
      <CardContent className="space-y-5 py-4">
        <h2 className="text-body font-semibold">{t('title')}</h2>
        {error && <p className="text-body text-destructive" role="alert">{error}</p>}
        {sheet === null ? (
          !error && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('loading')} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure label={t('value.originalValue')} value={m(sheet.value.originalValue)} />
              <Figure label={t('value.approvedVariations')} value={m(sheet.value.approvedVariations)} />
              <Figure label={t('value.revisedValue')} value={m(sheet.value.revisedValue)} />
              <Figure label={t('value.valueExVat')} value={m(sheet.value.valueExVat)} />
              <Figure label={t('billing.requested')} value={m(sheet.billing.requested)} />
              <Figure label={t('billing.paid')} value={m(sheet.billing.paid)} />
              <Figure label={t('billing.outstanding')} value={m(sheet.billing.outstanding)} />
            </dl>
            <CostSheetRows sheet={sheet} m={m} />
            <section className="space-y-2">
              <h3 className="text-body font-semibold">{t('margin.title')}</h3>
              {sheet.margin ? (
                <>
                  <dl className="grid grid-cols-2 gap-3">
                    <Figure label={t('margin.planned')} value={`${m(sheet.margin.planned)}${pct(sheet.margin.plannedPct)}`} />
                    <Figure label={t('margin.projected')} value={`${m(sheet.margin.projected)}${pct(sheet.margin.projectedPct)}`} />
                  </dl>
                  <p className="text-caption text-muted-foreground">{t('margin.note')}</p>
                </>
              ) : (
                <p className="text-body text-muted-foreground">{t('margin.hidden')}</p>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
