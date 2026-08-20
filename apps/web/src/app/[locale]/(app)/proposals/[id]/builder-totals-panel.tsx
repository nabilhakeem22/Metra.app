'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import type { DocTotals } from '@/lib/aggregates/proposal-totals';
import { formatMoney } from '@/lib/format/money';
import { INPUT_CLASS } from './builder-model';

export function BuilderTotalsPanel({
  discountPct,
  onDiscountPctChange,
  taxRate,
  onTaxRateChange,
  supervisionPct,
  onSupervisionPctChange,
  doc,
  seeMargin,
}: {
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

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            {t('builder.discountPct')}
            <FieldHint hint={th('discountPct')} />
            <Input dir="ltr" inputMode="decimal" value={discountPct} onChange={(e) => onDiscountPctChange(e.target.value)} className={`${inp} w-20`} />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            {t('builder.taxRate')}
            <FieldHint hint={th('taxRate')} />
            <Input dir="ltr" inputMode="decimal" value={taxRate} onChange={(e) => onTaxRateChange(e.target.value)} className={`${inp} w-20`} />
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            {t('builder.supervisionPct')}
            <FieldHint hint={th('supervisionPct')} />
            <Input dir="ltr" inputMode="decimal" value={supervisionPct} onChange={(e) => onSupervisionPctChange(e.target.value)} className={`${inp} w-20`} />
          </label>
        </div>
        <div className="ms-auto max-w-xs space-y-1 text-sm" dir="ltr">
          <Row label={t('builder.subtotal')} value={formatMoney(doc.subtotal, locale)} />
          <Row label={t('builder.docDiscount')} value={formatMoney(doc.discountAmount, locale)} />
          <Row label={t('builder.tax')} value={formatMoney(doc.taxAmount, locale)} />
          <Row label={t('builder.supervision')} value={formatMoney(doc.supervisionAmount, locale)} />
          <Row label={t('builder.total')} value={formatMoney(doc.total, locale)} bold />
          {seeMargin ? (
            <>
              <Row label={t('builder.cost')} value={formatMoney(doc.totalCost, locale)} />
              <Row label={t('builder.margin')} value={formatMoney(doc.totalMargin, locale)} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t('builder.marginHidden')}</p>
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
      <span>{value}</span>
    </div>
  );
}
