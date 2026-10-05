'use client';

import type { ConfirmOptions } from '@/components/ui/confirm-dialog';
import type { ProposalDraftState } from './proposal-payload';
import { useBoqBack } from './use-boq-back';
import { useSendAsBoq } from './use-send-as-boq';

/** Set for the delivery's BOQ working copy; null for a quote. */
export interface BoqModeProps {
  engagementId: string;
  clientCanOpenNow: boolean;
  canSend: boolean;
}

/**
 * The BOQ mode's two actions, Back and Send as BOQ, and the ONE flag that says
 * either is in flight. The builder disables everything on that flag: an edit
 * typed while the send is running would be saved AFTER the snapshot the BOQ was
 * cut from, so the studio would see a change on screen that the client never got.
 *
 * Called for a quote too (hooks cannot be conditional); nothing here acts until
 * one of the BOQ controls, which a quote never renders, is pressed.
 */
export function useBoqModeActions(options: {
  proposalId: string;
  boqMode: BoqModeProps | null;
  draftState: () => ProposalDraftState;
  totalBeforeVat: () => string;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const engagementId = options.boqMode?.engagementId ?? '';
  const back = useBoqBack({ engagementId, draftState: options.draftState });
  const sending = useSendAsBoq({
    proposalId: options.proposalId,
    engagementId,
    clientCanOpenNow: options.boqMode?.clientCanOpenNow ?? false,
    draftState: options.draftState,
    totalBeforeVat: options.totalBeforeVat,
    confirm: options.confirm,
  });
  return {
    back: back.back,
    backPending: back.pending,
    send: sending.send,
    sendPending: sending.pending,
    busy: back.pending || sending.pending,
  };
}
