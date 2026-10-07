'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { FigureInput } from './figure-input';
import type { DocTotals } from '@/lib/aggregates/proposal-totals';
import { formatMoney } from '@/lib/format/money';
import { INPUT_CLASS } from './builder-model';

/**
 * `mode: 'boq'` prices before VAT and supervision (both are added at the
 * contract), so their inputs and rows are not shown and the total says so.
 */
export function BuilderTotalsPanel({
  mode,
  discountPct,
  onDiscountPctChange,
  taxRate,
  onTaxRateChange,
  supervisionPct,
  onSupervisionPctChange,
  doc,
  seeMargin,
}: {
  mode: 'quote' | 'boq';
  discountPct: string;
  onDiscountPctChange: (value: string) => void;
  taxRate: string;
  onTaxRateChange: (value: string) => void;
  supervisionPct: string;
  onSupervisionPctChange: (value: string) => void;
  doc: DocTotals;
  seeMargin: boolean;
}) {
  const t = useTranslations('proposals');
  const th = useTranslations('hints.proposal');
  const locale = useLocale();
  const inp = INPUT_CLASS;
  const quote = mode === 'quote';

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-body">
            {t('builder.discountPct')}
            <FieldHint hint={th('discountPct')} />
            <FigureInput value={discountPct} onValueChange={onDiscountPctChange} className={`${inp} w-20`} />
          </label>
          {quote && (
            <>
              <label className="flex items-center gap-1.5 text-body">
                {t('builder.taxRate')}
                <FieldHint hint={th('taxRate')} />
                <FigureInput value={taxRate} onValueChange={onTaxRateChange} className={`${inp} w-20`} />
              </label>
              <label className="flex items-center gap-1.5 text-body">
                {t('builder.supervisionPct')}
                <FieldHint hint={th('supervisionPct')} />
                <FigureInput value={supervisionPct} onValueChange={onSupervisionPctChange} className={`${inp} w-20`} />
              </label>
            </>
          )}
        </div>
        <div className="ms-auto max-w-xs space-y-1 text-body">
          <Row label={t('builder.subtotal')} value={formatMoney(doc.subtotal, locale)} />
          <Row label={t('builder.docDiscount')} value={formatMoney(doc.discountAmount, locale)} />
          {quote && (
            <>
              <Row label={t('builder.tax')} value={formatMoney(doc.taxAmount, locale)} />
              <Row label={t('builder.supervision')} value={formatMoney(doc.supervisionAmount, locale)} />
            </>
          )}
          <Row
            label={quote ? t('builder.total') : t('boqMode.totalBeforeVat')}
            value={formatMoney(doc.total, locale)}
            bold
          />
          {seeMargin ? (
            <>
              <Row label={t('builder.cost')} value={formatMoney(doc.totalCost, locale)} />
              <Row label={t('builder.margin')} value={formatMoney(doc.totalMargin, locale)} />
            </>
          ) : (
            <p className="text-caption text-muted-foreground">{t('builder.marginHidden')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span dir="ltr">{value}</span>
    </div>
  );
}
