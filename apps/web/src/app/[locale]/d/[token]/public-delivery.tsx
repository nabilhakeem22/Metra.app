'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { DeliveryReadResult } from '@/lib/engagements/public';
import { BudgetCard } from './portal/budget-card';
import { DocumentsCard } from './portal/documents-card';
import { FirmHeader } from './portal/firm-header';
import { Greeting } from './portal/greeting';
import { PaymentsCard } from './portal/payments-card';
import { PortalCommandCard } from './portal/command-card';

/**
 * The session-less, mobile-first, firm-branded client portal — a guided single
 * column: firm header → greeting → the command card (journey, the ONE thing that
 * needs the client now, what's next) → an optional subordinate budget card → the
 * payments card (a payment due is something the client acts on, so it sits above
 * the documents) → the released documents → footer. Every derivation (journey
 * position, hero) is computed server-side and carries NO raw machine state; the
 * payments card's sums are exact scale-4 math. Every figure is a client-DUE
 * amount (no cost/margin ever reaches this surface). Bilingual, RTL-safe, Western
 * numerals, logical CSS only. A read that produced no delivery renders ONE OF TWO
 * notices, and which one matters: `not_found` is permanent and tells the client to
 * ask their design team for a new link; `read_failed` is transient and tells them
 * their link is still valid.
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
    return (
      <div className="client-portal flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-lg font-semibold">{t(notice + '.title')}</p>
          <p className="text-sm text-muted-foreground">{t(notice + '.body')}</p>
        </div>
      </div>
    );
  }

  const { delivery } = read;

  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const firmName = pick(delivery.firm.nameAr, delivery.firm.nameEn) || 'Metra';
  const title = pick(delivery.titleAr, delivery.titleEn);
  const clientName = pick(delivery.client.nameAr, delivery.client.nameEn);

  return (
    <div className="client-portal min-h-screen">
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4 md:py-8">
        <FirmHeader firmName={firmName} />
        <Greeting clientName={clientName} title={title} />
        <PortalCommandCard
          token={token}
          hero={delivery.hero}
          milestone={delivery.milestone}
          stageLabel={delivery.stageLabel}
          stageNote={delivery.stageNote}
        />
        {delivery.hero.showRomAck && <BudgetCard token={token} rom={delivery.rom} />}
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
        <footer className="pt-2 text-center text-xs text-muted-foreground">
          {t('poweredBy', { firm: firmName })}
        </footer>
      </div>
    </div>
  );
}
