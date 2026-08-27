'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/format/money';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { pickPortalLabel } from '@/lib/engagements/portal-labels';
import type {
  PublicDelivery,
  PublicDeliveryMilestone,
} from '@/lib/engagements/public';

/**
 * The session-less, mobile-first, firm-branded client portal view. READ-ONLY in
 * P1 — no action buttons. Every figure is a client-facing amount (fee due / budget
 * band); no cost, margin, or internal state ever reaches this surface (the SDF
 * omits them physically). Bilingual, RTL-safe, Western numerals.
 */
export function PublicDeliveryView({
  delivery,
}: {
  delivery: PublicDelivery | null;
}) {
  const t = useTranslations('delivery');
  const locale = useLocale();

  if (!delivery) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-lg font-semibold">{t('notFound.title')}</p>
          <p className="text-sm text-muted-foreground">{t('notFound.body')}</p>
        </div>
      </div>
    );
  }

  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const m = (v: string | null) => (v ? formatMoney(v, locale) : '');
  const firmName = pick(delivery.firm.nameAr, delivery.firm.nameEn) || 'Metra';
  const title = pick(delivery.titleAr, delivery.titleEn);
  const clientName = pick(delivery.client.nameAr, delivery.client.nameEn);
  const num = formatDocNumber('DE', delivery.number, docYear(null, delivery.createdAt));

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-lg space-y-4 p-4 md:py-8">
        {/* Firm branding */}
        <header className="flex items-center gap-3 rounded-xl border bg-background p-4 shadow-sm">
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg font-bold text-primary"
            aria-hidden
          >
            {firmName.trim().charAt(0) || 'M'}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{firmName}</p>
            {clientName && (
              <p className="truncate text-sm text-muted-foreground">
                {t('forClient', { name: clientName })}
              </p>
            )}
          </div>
        </header>

        {/* Delivery identity + prominent stage */}
        <section className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground" dir="ltr">
              {num}
            </p>
          </div>
          {title && <h1 className="text-lg font-semibold">{title}</h1>}
          <div className="rounded-lg bg-primary/5 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              {t('stageEyebrow')}
            </p>
            <p className="mt-0.5 text-base font-semibold">
              {pickPortalLabel(delivery.stageLabel, locale)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pickPortalLabel(delivery.stageNote, locale)}
            </p>
          </div>
        </section>

        {/* Budget range (client-acknowledged band) */}
        {delivery.rom && (delivery.rom.low || delivery.rom.high) && (
          <section className="space-y-1 rounded-xl border bg-background p-4 shadow-sm">
            <h2 className="text-sm font-semibold">{t('budget.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('budget.hint')}</p>
            <p className="pt-1 font-medium" dir="ltr">
              {delivery.rom.low && delivery.rom.high
                ? t('budget.range', {
                    low: m(delivery.rom.low),
                    high: m(delivery.rom.high),
                  })
                : m(delivery.rom.low ?? delivery.rom.high)}
            </p>
          </section>
        )}

        {/* Payment schedule — amounts DUE only */}
        {delivery.paymentSchedule.length > 0 && (
          <section className="space-y-2 rounded-xl border bg-background p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('payments.title')}</h2>
              {delivery.designFeeTotal && (
                <span className="text-sm text-muted-foreground" dir="ltr">
                  {t('payments.total')}: {m(delivery.designFeeTotal)}
                </span>
              )}
            </div>
            <ul className="divide-y">
              {delivery.paymentSchedule.map((row) => (
                <MilestoneRow key={row.milestone_kind} row={row} m={m} />
              ))}
            </ul>
          </section>
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          {t('poweredBy', { firm: firmName })}
        </footer>
      </div>
    </div>
  );
}

function MilestoneRow({
  row,
  m,
}: {
  row: PublicDeliveryMilestone;
  m: (v: string | null) => string;
}) {
  const t = useTranslations('delivery');
  const statusTone =
    row.status === 'paid'
      ? 'bg-emerald-100 text-emerald-700'
      : row.status === 'partial'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-muted text-muted-foreground';
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {t(`milestone.${row.milestone_kind}`)}
        </p>
        <span
          className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs ${statusTone}`}
        >
          {t(`status.${row.status}`)}
        </span>
      </div>
      <span className="shrink-0 text-sm font-semibold" dir="ltr">
        {m(row.amount_due)}
      </span>
    </li>
  );
}
