import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DashboardBarChart } from '@/components/dashboard/dashboard-bar-chart';
import { RescueFigureCard } from '@/components/dashboard/rescue-figure-card';
import { Card, CardContent } from '@/components/ui/card';
import { collectedColumns, RESCUE_SERIES_KEYS, stagesMovedColumns } from '@/lib/dashboard/rescue-ledger/chart-columns';
import { pluralParams } from '@/lib/format/plural-params';
import type { RescueLedger, RescueMoneyFigure } from '@/lib/dashboard/rescue-ledger/types';
import { cachedDateTimeFormat } from '@/lib/format/intl-cache';
import { formatMoney } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';

// A PLAIN module (no 'use client'): the island that fetches the ledger renders
// it, and its test renders it straight from a fixture.
//
// Every figure here is REAL (R3, R4) or a count (R2). The "Protected ·
// estimated" card is locked and carries no number at all (D4), so nothing on
// this block can be read as an estimate added to collected money.

export function RescueLedgerView({ ledger, locale }: { ledger: RescueLedger; locale: string }) {
  const t = useTranslations('dashboard.rescue');
  const months = pluralParams('count', 'countText', ledger.rangeMonths, locale);
  const monthLabel = (month: string) =>
    cachedDateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  // A zero figure gets a line that claims nothing happened, never "0 payments on 0 deliveries".
  const moneyInputs = (figure: RescueMoneyFigure) =>
    figure.payments === 0
      ? t('cards.moneyNone')
      : t('cards.moneyInputs', {
          ...pluralParams('paymentCount', 'paymentText', figure.payments, locale),
          ...pluralParams('deliveryCount', 'deliveryText', figure.deliveries, locale),
        });
  const stagesMovedInputs =
    ledger.stagesMoved.count === 0
      ? t('cards.stagesMovedNone')
      : t('cards.stagesMovedInputs', pluralParams('followupCount', 'followupText', ledger.stagesMoved.followups, locale));
  const source = t('basedOnYourData');

  return (
    <section className="flex flex-col gap-[14px]" aria-labelledby="rescue-ledger-title">
      <div className="px-1.5">
        <h2 id="rescue-ledger-title" className="text-title font-bold text-[color:var(--text)]">{t('title')}</h2>
        <p className="text-body text-[color:var(--text-muted)]">{t('summary', months)}</p>
      </div>

      <div className="grid gap-[14px] sm:grid-cols-2 lg:grid-cols-3">
        <RescueFigureCard
          title={t('cards.collected')}
          figure={formatMoney(ledger.collected.amount, locale)}
          inputs={moneyInputs(ledger.collected)}
          hint={t('cards.collectedHint')}
          sourceTag={source}
        />
        <RescueFigureCard
          title={t('cards.heldFees')}
          figure={formatMoney(ledger.heldFees.amount, locale)}
          inputs={moneyInputs(ledger.heldFees)}
          sourceTag={source}
        />
        <RescueFigureCard
          title={t('cards.changeOrders')}
          figure={formatMoney(ledger.changeOrders.amount, locale)}
          inputs={moneyInputs(ledger.changeOrders)}
          sourceTag={source}
        />
        <RescueFigureCard
          title={t('cards.stagesMoved')}
          figure={formatNumber(ledger.stagesMoved.count, locale)}
          inputs={stagesMovedInputs}
          sourceTag={source}
        />
        <Card className="h-full sm:col-span-2 lg:col-span-2">
          <CardContent className="flex h-full flex-col gap-1.5 py-4">
            <p className="text-body font-medium text-muted-foreground">{t('cards.protectedTitle')}</p>
            <p className="inline-flex items-center gap-1.5 text-body text-muted-foreground">
              <Lock className="size-4 shrink-0" aria-hidden />
              {t('cards.protectedLocked')}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <DashboardBarChart
          title={t('charts.collected')}
          summary={t('charts.collectedSummary', months)}
          caption={source}
          columns={collectedColumns(ledger.months, locale, monthLabel)}
          series={[
            { key: RESCUE_SERIES_KEYS.heldFees, label: t('series.heldFees'), token: '--chart-1' },
            { key: RESCUE_SERIES_KEYS.changeOrders, label: t('series.changeOrders'), token: '--chart-2' },
          ]}
          emptyLabel={t('empty')}
          totalLabel={t('total')}
        />
        <DashboardBarChart
          title={t('charts.stagesMoved')}
          summary={t('charts.stagesMovedSummary', months)}
          caption={source}
          columns={stagesMovedColumns(ledger.months, locale, monthLabel)}
          series={[{ key: RESCUE_SERIES_KEYS.stagesMoved, label: t('series.stagesMoved'), token: '--chart-1' }]}
          emptyLabel={t('empty')}
          totalLabel={t('total')}
        />
      </div>
    </section>
  );
}
