'use client';

import { useTranslations } from 'next-intl';
import type { HomeContract } from '@/lib/client-home/types';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { ContractSignPanel } from './contract-sign-panel';
import type { KnownCodeChannel } from './use-client-code';
import type { SignNotice } from './use-contract-signing';
import type { StudioContactFacts } from './use-studio-whatsapp';

/** What signing the contract in the home needs from the page. */
export interface ContractSigningFacts {
  /** The contract's document, read with the page while it awaits the client's signature; null otherwise, or when its read failed. */
  document: ContractDocument | null;
  /** Where a one-time code would go, or null with no address on file. */
  channel: KnownCodeChannel;
  studio: StudioContactFacts;
  /** The contract whose signing opens on its code box (a code email's `?focus=sign:<id>`), or null. */
  openOn: string | null;
  /** Read the page again: the refreshed home decides the hero and the card. */
  onChanged: () => void;
}

/**
 * The step an ISSUED contract waits on, under its document: while the online
 * signing window is open, the signing itself (./contract-sign-panel.tsx), or,
 * when the document could not be read with the page, a plain "refresh" (the
 * client signs only what they can see); once the window has closed, the
 * studio to contact. A sentence the section already says about the signing
 * (`noticeShown`) stands in for the closed window's.
 */
export function ContractIssuedStep({
  token,
  contract,
  awaitingSignature,
  signing,
  noticeShown,
  onNotice,
}: {
  token: string;
  contract: HomeContract;
  /** The client's move is to sign it (the hero's `sign_contract`). */
  awaitingSignature: boolean;
  signing: ContractSigningFacts;
  noticeShown: boolean;
  onNotice: (notice: SignNotice | null) => void;
}) {
  const t = useTranslations('delivery.contract');
  const note = (text: string) => <p className="rounded-item bg-muted/50 p-3 text-caption text-muted-foreground">{text}</p>;
  if (!awaitingSignature) return noticeShown ? null : note(t('signingClosed', { studio: signing.studio.name }));
  if (!signing.document) return note(t('sign.unavailable'));
  return (
    <ContractSignPanel
      key={contract.id}
      token={token}
      contract={contract}
      channel={signing.channel}
      studio={signing.studio}
      onNotice={onNotice}
      onChanged={signing.onChanged}
      typingFor={signing.openOn}
    />
  );
}
