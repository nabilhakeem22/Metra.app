'use client';

import { BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { LetteredConceptOption } from '@/lib/engagements/concept-choice';
import type { Trigger } from '@/lib/engagements/transitions';
import {
  OfflineApprovalForm,
  isOfflineApprovalTrigger,
} from './offline-approval-form';
import type { RunAction } from './use-engagement-action';

/**
 * WAITING ON THE CLIENT: Advance is dead machinery here (only the client acting
 * enables it), so it is replaced by what the studio can still do. Remind the
 * client (owner/admin: the dialog sends the link they already hold, on WhatsApp
 * or by email), and, once every guard is met and only the client's answer to
 * the review is missing, record an approval the client gave the studio directly
 * ("Client approved offline", owner, admin and project manager only; anyone else
 * reads who may). The reminder is the card's ONE filled primary action
 * (`data-primary-action`) unless a payment opener above already is.
 */
export function CommandCardWaitingClient({
  engagementId,
  trigger,
  offlineApproval,
  reviewAnswerOnly,
  reviewRoundStartedAt,
  conceptOptions,
  canShare,
  primary,
  pending,
  onNudge,
  runAction,
}: {
  engagementId: string;
  /** The forward trigger the offline approval fires (selectConcept / approveDesign). */
  trigger: Trigger | null;
  /** CommandCardCtas.offlineApproval: guards met, waiting, and the role may stand in. */
  offlineApproval: boolean;
  /** Every guard is met and only the client's answer to the review is missing. */
  reviewAnswerOnly: boolean;
  /** When that review round began (ISO): the offline approval's date floor. */
  reviewRoundStartedAt: string;
  /** The lettered options an offline concept choice may name. */
  conceptOptions: LetteredConceptOption[];
  canShare: boolean;
  /** False when a payment opener above is already the filled primary action. */
  primary: boolean;
  pending: boolean;
  /** Opens the "Send reminder" dialog. */
  onNudge: () => void;
  runAction: RunAction;
}) {
  const tcmd = useTranslations('engagements.command');
  const toffline = useTranslations('engagements.offlineApproval');
  const [formOpen, setFormOpen] = useState(false);
  // The edge an offline approval would fire, when one may be recorded here.
  const offlineTrigger = offlineApproval && isOfflineApprovalTrigger(trigger) ? trigger : null;
  // Another role sees who may record it instead of a button it cannot press.
  const decidedByOthers = !offlineTrigger && reviewAnswerOnly && isOfflineApprovalTrigger(trigger);

  return (
    <>
      {canShare && (
        <Button
          type="button"
          variant={primary ? 'default' : 'secondary'}
          data-primary-action={primary ? '' : undefined}
          className="w-full"
          disabled={pending}
          onClick={onNudge}
        >
          <BellRing className="size-4" aria-hidden />
          {tcmd('sendReminder')}
        </Button>
      )}
      {offlineTrigger && !formOpen && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={pending}
          onClick={() => setFormOpen(true)}
        >
          {toffline('open')}
        </Button>
      )}
      {decidedByOthers && (
        <p className="text-small text-[color:var(--text-muted)]">{toffline('decidedBy')}</p>
      )}
      {offlineTrigger && formOpen && (
        <OfflineApprovalForm
          engagementId={engagementId}
          trigger={offlineTrigger}
          reviewRoundStartedAt={reviewRoundStartedAt}
          conceptOptions={conceptOptions}
          pending={pending}
          runAction={runAction}
          onCancel={() => setFormOpen(false)}
        />
      )}
    </>
  );
}
