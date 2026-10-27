'use client';

import { Loader2, PenLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LinkNameField } from '@/components/share/link-name-field';
import { Button } from '@/components/ui/button';
import { signerNameOf } from '@/lib/client-home/signer-name';
import { bidiIsolate } from '@/lib/format/bidi';
import { ClientCodePanel } from './client-code-panel';
import { ConfirmActDialog } from './confirm-act-dialog';
import type { KnownCodeChannel } from './use-client-code';
import { useContractSigning, type SignNotice } from './use-contract-signing';
import { useStudioWhatsappHref, type StudioContactFacts } from './use-studio-whatsapp';

/**
 * Signing the execution contract in the home, under its document (open with
 * the page): the client types their full name inline, as on /c, and [Sign the
 * contract] opens the dialog that names the contract and the name and holds
 * the one-time code (./client-code-panel.tsx): Confirm waits for the code. A
 * client with no address on file is told so with the studio's WhatsApp
 * instead, with no name box and no button: the contract is then signed on
 * paper with the studio. /c's disclaimer stands under the button word for word
 * (OD-S1). The element id `sign-<id>` is what a code email's `?focus=sign:<id>`
 * scrolls to. فصحى copy, Latin digits, logical CSS only.
 */
export function ContractSignPanel({
  token,
  contract,
  channel,
  studio,
  onNotice,
  onChanged,
  typingFor,
}: {
  token: string;
  contract: { id: string; documentNumber: string };
  channel: KnownCodeChannel;
  studio: StudioContactFacts;
  onNotice: (notice: SignNotice | null) => void;
  onChanged: () => void;
  /** The contract whose signing opens on its code box (a code email's link), or null. */
  typingFor: string | null;
}) {
  const t = useTranslations('delivery.contract.sign');
  const tActions = useTranslations('delivery.actions');
  const signing = useContractSigning(token, contract.id, channel, onNotice, onChanged, typingFor);
  const whatsappHref = useStudioWhatsappHref(studio.whatsappDigits, studio.deliveryRef, 'execution');
  const number = bidiIsolate(contract.documentNumber);
  const codePanel = <ClientCodePanel code={signing.code} studioName={studio.name} whatsappHref={whatsappHref} />;

  return (
    <div id={`sign-${contract.id}`} className="space-y-3 rounded-item border p-3" data-sign-panel>
      {signing.code.noChannel ? (
        codePanel
      ) : (
        <>
          <p className="text-body text-muted-foreground">{t('intro')}</p>
          <LinkNameField
            ref={signing.nameRef}
            id={`sign-name-${contract.id}`}
            label={t('nameLabel')}
            value={signing.name}
            onChange={signing.setName}
            error={signing.nameMissing ? t('nameRequired') : null}
          />
          <Button variant="default" className="min-h-11 w-full" disabled={signing.pending} onClick={signing.start}>
            {signing.pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PenLine className="size-4" aria-hidden />}
            {t('button')}
          </Button>
          <p className="text-caption text-muted-foreground">{t('notSignature')}</p>
        </>
      )}
      <ConfirmActDialog
        open={signing.asking}
        title={t('confirmTitle', { number })}
        body={
          <>
            <p>{t('confirmBody', { number, name: bidiIsolate(signerNameOf(signing.name) ?? '') })}</p>
            {codePanel}
          </>
        }
        confirmLabel={t('confirm')}
        cancelLabel={tActions('cancel')}
        pending={signing.pending}
        confirmDisabled={!signing.code.ready}
        confirmShown={!signing.code.noChannel}
        onConfirm={signing.confirm}
        onOpenChange={(open) => !open && signing.dismiss()}
      />
    </div>
  );
}
