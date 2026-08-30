'use client';

import { useLocale, useTranslations } from 'next-intl';
import { paymentGlance } from '@/lib/engagements/portal-hero';
import type { PublicDelivery } from '@/lib/engagements/public';
import { DocumentsCard } from './portal/documents-card';
import { FirmHeader } from './portal/firm-header';
import { Greeting } from './portal/greeting';
import { HeroCard } from './portal/hero-card';
import { JourneyTracker } from './portal/journey-tracker';
import { PaymentClaimCard } from './portal/payment-claim-card';
import { PaymentGlanceCard } from './portal/payment-glance';
import { RomAckCard } from './portal/rom-ack-card';
import { WhatsNext } from './portal/whats-next';

/**
 * The session-less, mobile-first, firm-branded client portal — a guided single
 * column: firm header → greeting → journey tracker → the ONE thing that needs the
 * client now (hero) → an optional subordinate budget-ack → the released documents →
 * payment glance → what's-next → footer. Every derivation (journey position, hero) is computed
 * server-side and carries NO raw machine state; every figure is a client-DUE
 * amount (no cost/margin ever reaches this surface). Bilingual, RTL-safe, Western
 * numerals, logical CSS only. A null delivery renders the friendly not-found.
 */
export function PublicDeliveryView({
  token,
  delivery,
  documentUnavailable = false,
}: {
  token: string;
  delivery: PublicDelivery | null;
  /** Set when the download route bounced back — the client asked for a document
   *  that is not (or is no longer) available to them. */
  documentUnavailable?: boolean;
}) {
  const t = useTranslations('delivery');
  const locale = useLocale();

  if (!delivery) {
    return (
      <div className="client-portal flex min-h-screen items-center justify-center p-6 text-center">
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
  const firmName = pick(delivery.firm.nameAr, delivery.firm.nameEn) || 'Metra';
  const title = pick(delivery.titleAr, delivery.titleEn);
  const clientName = pick(delivery.client.nameAr, delivery.client.nameEn);
  const glance = paymentGlance(delivery.paymentSchedule);

  return (
    <div className="client-portal min-h-screen">
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4 md:py-8">
        <FirmHeader firmName={firmName} />
        <Greeting clientName={clientName} title={title} />
        <JourneyTracker milestone={delivery.milestone} />
        <HeroCard
          token={token}
          hero={delivery.hero}
          stageLabel={delivery.stageLabel}
          stageNote={delivery.stageNote}
        />
        {delivery.hero.showRomAck && <RomAckCard token={token} />}
        <DocumentsCard
          token={token}
          documents={delivery.documents}
          documentUnavailable={documentUnavailable}
        />
        <PaymentGlanceCard glance={glance} />
        <PaymentClaimCard token={token} claim={delivery.paymentClaim} />
        <WhatsNext milestone={delivery.milestone} />
        <footer className="pt-2 text-center text-xs text-muted-foreground">
          {t('poweredBy', { firm: firmName })}
        </footer>
      </div>
    </div>
  );
}
