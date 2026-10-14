'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { FigureInput } from './figure-input';
import type { DocTotals } from '@/lib/aggregates/proposal-totals';
import { formatMoney } from '@/lib/format/money';
import { INPUT_CLASS } from './builder-model';
import { CellError, cellA11y } from './draft-cell';
import type { DraftFieldErrorsApi } from './use-draft-field-errors';

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
  cells,
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
  /** The header refusals of the last save, under each percentage. */
  cells: DraftFieldErrorsApi;
}) {
  const t = useTranslations('proposals');
  const th = useTranslations('hints.proposal');
  const locale = useLocale();
  const inp = INPUT_CLASS;
  const quote = mode === 'quote';
  const percent = (
    path: 'discountPct' | 'taxRate' | 'supervisionPct',
    value: string,
    onChange: (value: string) => void,
  ) => {
    const cell = cells.cell(path);
    const id = `doc-${path}`;
    return (
      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-body">
          {t(`builder.${path}`)}
          <FieldHint hint={th(path)} />
          <FigureInput
            id={id}
            value={value}
            onValueChange={(next) => {
              cell.clear();
              onChange(next);
            }}
            className={`${inp} w-20`}
            {...cellA11y(id, cell)}
          />
        </label>
        <CellError id={id} error={cell} />
      </div>
    );
  };

  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-center gap-3">
          {percent('discountPct', discountPct, onDiscountPctChange)}
          {quote && (
            <>
              {percent('taxRate', taxRate, onTaxRateChange)}
              {percent('supervisionPct', supervisionPct, onSupervisionPctChange)}
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
