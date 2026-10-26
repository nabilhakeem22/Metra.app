'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { DeliveryReadResult } from '@/lib/engagements/public';
import { deliveryDisplayNames, deliveryReference } from '@/lib/engagements/public/display-names';
import { HomeTabs } from './home-tabs';
import { BudgetCard } from './portal/budget-card';
import { PortalCommandCard } from './portal/command-card';
import { DeliveryNotice } from './portal/delivery-notice';
import { DesignRecordBanner } from './portal/design-record-banner';
import { DocumentsCard } from './portal/documents-card';
import { Greeting } from './portal/greeting';
import { PaymentsCard } from './portal/payments-card';
import { StudioBar } from './portal/studio-bar';
import { TimelineCard } from './portal/timeline-card';

/**
 * The client home's DESIGN tab: the session-less, mobile-first, studio-branded
 * client page, a guided single column under a sticky studio bar (logo, name,
 * WhatsApp, call, language): greeting → the command card (journey, the ONE
 * thing that needs the client now, what's next) → the budget card whenever the
 * studio has issued a range → the payments card (a payment due is something
 * the client acts on, so it sits above the documents; how to pay and what was
 * received live there too) → the released documents → what happened, dated →
 * footer. Once the delivery is at `execution` it is the DESIGN RECORD: the tab
 * strip above it, and the record banner (every step done) where the command
 * card was; the execution contract lives in the Execution tab
 * (./execution-tab.tsx), never here. Every derivation (journey position, stage,
 * hero, timeline words) is computed server-side and carries NO raw machine
 * state; every figure is a client-DUE or client-PAID amount (no cost/margin
 * ever reaches this surface). Bilingual, RTL-safe, Western numerals, logical
 * CSS only. A read that produced no delivery renders a notice instead
 * (./portal/delivery-notice.tsx).
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
  const record = delivery.stageKey === 'construction';

  const { firmName, title, clientName } = deliveryDisplayNames(delivery, locale);
  // A range with neither bound (a malformed snapshot) has nothing to show.
  const rom = delivery.rom?.low || delivery.rom?.high ? delivery.rom : null;

  return (
    <div className="client-portal min-h-screen">
      <StudioBar
        firmName={firmName}
        firm={delivery.firm}
        deliveryRef={deliveryReference(delivery)}
        token={token}
        locale={locale}
        tab={record ? 'design' : null}
      />
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <Greeting clientName={clientName} title={title} />
        {record ? (
          <>
            <HomeTabs token={token} current="design" />
            <DesignRecordBanner milestone={delivery.milestone} />
          </>
        ) : (
          <PortalCommandCard
            token={token}
            hero={delivery.hero}
            milestone={delivery.milestone}
            stageKey={delivery.stageKey}
            review={delivery}
          />
        )}
        {rom && (
          <BudgetCard
            token={token}
            rom={rom}
            canAcknowledge={delivery.hero.showRomAck}
            acknowledgedAt={delivery.romAcknowledgedAt}
            prominent={delivery.hero.kind !== 'action'}
          />
        )}
        <PaymentsCard
          token={token}
          schedule={delivery.paymentSchedule}
          claim={delivery.paymentClaim}
          details={delivery.paymentDetails}
          receipts={delivery.receipts}
          receiptsTruncated={delivery.receiptsTruncated}
        />
        <DocumentsCard
          token={token}
          documents={delivery.documents}
          documentUnavailable={documentUnavailable}
        />
        <TimelineCard timeline={delivery.timeline} lastUpdateAt={delivery.lastUpdateAt} />
        <footer className="pt-2 text-center text-caption text-muted-foreground">
          {t('poweredBy', { firm: firmName })}
        </footer>
      </div>
    </div>
  );
}
