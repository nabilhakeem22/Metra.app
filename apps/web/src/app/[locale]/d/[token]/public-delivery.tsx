'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { DeliveryReadResult } from '@/lib/engagements/public';
import { BudgetCard } from './portal/budget-card';
import { PortalCommandCard } from './portal/command-card';
import { DeliveryNotice } from './portal/delivery-notice';
import { DocumentsCard } from './portal/documents-card';
import { Greeting } from './portal/greeting';
import { PaymentsCard } from './portal/payments-card';
import { StudioBar } from './portal/studio-bar';

/**
 * The session-less, mobile-first, studio-branded client page — a guided single
 * column under a sticky studio bar: greeting → the command card (journey, the
 * ONE thing that needs the client now, what's next) → the budget card whenever
 * the studio has issued a range → the payments card (a payment due is something
 * the client acts on, so it sits above the documents) → the released documents
 * → footer. Every derivation (journey position, stage, hero) is computed
 * server-side and carries NO raw machine state; every figure is a client-DUE
 * amount (no cost/margin ever reaches this surface). Bilingual, RTL-safe,
 * Western numerals, logical CSS only. A read that produced no delivery renders
 * a notice instead (./portal/delivery-notice.tsx).
 */
export function PublicDeliveryView({
  token,
  read,
  documentUnavailable = false,
}: {
  token: string;
  read: DeliveryReadResult;
  /** Set when the download route bounced back — the client asked for a document
   *  that is not (or is no longer) available to them. */
  documentUnavailable?: boolean;
}) {
  const t = useTranslations('delivery');
  const locale = useLocale();

  if (read.status !== 'ok') {
    const notice = read.status === 'read_failed' ? 'readFailed' : 'notFound';
    return <DeliveryNotice notice={notice} token={token} locale={locale} />;
  }

  const { delivery } = read;

  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const firmName = pick(delivery.firm.nameAr, delivery.firm.nameEn) || 'Metra';
  const title = pick(delivery.titleAr, delivery.titleEn);
  const clientName = pick(delivery.client.nameAr, delivery.client.nameEn);
  // A range with neither bound (a malformed snapshot) has nothing to show.
  const rom = delivery.rom?.low || delivery.rom?.high ? delivery.rom : null;

  return (
    <div className="client-portal min-h-screen">
      <StudioBar firmName={firmName} token={token} locale={locale} />
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4 md:py-8">
        <Greeting clientName={clientName} title={title} />
        <PortalCommandCard
          token={token}
          hero={delivery.hero}
          milestone={delivery.milestone}
          stageKey={delivery.stageKey}
          concept={delivery}
        />
        {rom && <BudgetCard token={token} rom={rom} canAcknowledge={delivery.hero.showRomAck} />}
        <PaymentsCard
          token={token}
          schedule={delivery.paymentSchedule}
          claim={delivery.paymentClaim}
        />
        <DocumentsCard
          token={token}
          documents={delivery.documents}
          documentUnavailable={documentUnavailable}
        />
        <footer className="pt-2 text-center text-caption text-muted-foreground">
          {t('poweredBy', { firm: firmName })}
        </footer>
      </div>
    </div>
  );
}
