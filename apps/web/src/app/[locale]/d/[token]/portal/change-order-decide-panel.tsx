'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { LinkNameField } from '@/components/share/link-name-field';
import { Button } from '@/components/ui/button';
import { signerNameOf } from '@/lib/client-home/signer-name';
import type { HomeChangeOrder } from '@/lib/client-home/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatMoneyExact } from '@/lib/format/money';
import { ClientCodePanel } from './client-code-panel';
import { ConfirmActDialog } from './confirm-act-dialog';
import type { KnownCodeChannel } from './use-client-code';
import { useChangeOrderDecision, type DecideNotice } from './use-change-order-decision';
import { useStudioWhatsappHref, type StudioContactFacts } from './use-studio-whatsapp';

/**
 * Approving or rejecting one change order in the home: the client types their
 * full name inline, and [Approve] or [Reject] opens the dialog that names the
 * order, its total and the name and holds the one-time code
 * (./client-code-panel.tsx): Confirm waits for the code. A client with no address
 * on file is told so with the studio's WhatsApp instead, with no name box and no
 * button: the decision is then given on paper. فصحى copy, Latin digits, logical
 * CSS only.
 */
export function ChangeOrderDecidePanel({
  token,
  order,
  channel,
  studio,
  onNotice,
  onChanged,
  typingFor,
}: {
  token: string;
  order: HomeChangeOrder;
  channel: KnownCodeChannel;
  studio: StudioContactFacts;
  onNotice: (notice: DecideNotice | null) => void;
  onChanged: () => void;
  /** The order whose decision opens on its code box (a code email's link), or null. */
  typingFor: string | null;
}) {
  const t = useTranslations('delivery.changeOrders.decide');
  const tActions = useTranslations('delivery.actions');
  const locale = useLocale();
  const deciding = useChangeOrderDecision(token, order.id, channel, onNotice, onChanged, typingFor);
  const whatsappHref = useStudioWhatsappHref(studio.whatsappDigits, studio.deliveryRef, 'execution');
  const number = bidiIsolate(String(order.number));
  const name = bidiIsolate(signerNameOf(deciding.box.name) ?? '');
  const total = bidiIsolate(formatMoneyExact(order.total, locale));
  const codePanel = <ClientCodePanel code={deciding.code} studioName={studio.name} whatsappHref={whatsappHref} />;

  return (
    <div className="space-y-3" data-decide-panel>
      {deciding.code.noChannel ? (
        codePanel
      ) : (
        <>
          <p className="text-body text-muted-foreground">{t('intro')}</p>
          <LinkNameField
            ref={deciding.box.nameRef}
            id={`decide-name-${order.id}`}
            label={t('nameLabel')}
            value={deciding.box.name}
            onChange={deciding.box.setName}
            error={deciding.box.nameMissing ? t('nameRequired') : null}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="default" className="min-h-11 w-full sm:flex-1" disabled={deciding.pending} onClick={() => deciding.start('approve')}>
              {deciding.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('approve')}
            </Button>
            <Button variant="secondary" className="min-h-11 w-full sm:flex-1" disabled={deciding.pending} onClick={() => deciding.start('reject')}>
              {t('reject')}
            </Button>
          </div>
        </>
      )}
      {/* Mounted only while open: a page of ten cards renders no dialog (the Worker's CPU). */}
      {deciding.decision && (
        <ConfirmActDialog
          open
          title={t(`confirmTitle.${deciding.decision}`, { number })}
          body={
            <>
              <p className="[overflow-wrap:anywhere]">{t(`confirmBody.${deciding.decision}`, { number, total, name })}</p>
              {codePanel}
            </>
          }
          confirmLabel={t(`confirm.${deciding.decision}`)}
          cancelLabel={tActions('cancel')}
          pending={deciding.pending}
          confirmDisabled={!deciding.code.ready}
          confirmShown={!deciding.code.noChannel}
          onConfirm={deciding.confirm}
          onOpenChange={(open) => !open && deciding.dismiss()}
        />
      )}
    </div>
  );
}
