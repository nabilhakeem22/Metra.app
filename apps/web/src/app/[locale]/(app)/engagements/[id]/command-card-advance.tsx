'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { CommandCardActionProps } from './command-card-action';
import { CommandCardEndings } from './command-card-endings';
import { CommandCardWaitingClient } from './command-card-waiting-client';
import { DIRECT_TRIGGER_ACTIONS } from './trigger-actions';

/** Dispatch the forward trigger, or open the form the edge needs first. */
function fireAdvance(props: CommandCardActionProps): void {
  if (props.view.advanceNeedsForm) {
    props.advance.openFeeForm();
    return;
  }
  const trigger = props.advance.preview.primaryTrigger;
  if (!trigger) return;
  const action = DIRECT_TRIGGER_ACTIONS[trigger];
  // The trigger travels with the call: it is what the held key belongs to.
  if (action) {
    props.advance.runAction(
      (idempotencyKey) => action(props.advance.engagementId, idempotencyKey),
      trigger,
    );
  }
}

/**
 * WAITING ON THE CLIENT: the ADVANCE is dead machinery (nothing the studio does
 * enables it, only the client acting does), so it is replaced by what the studio
 * can still do on this card (command-card-waiting-client.tsx).
 *
 * Note what is NOT hidden: logging a payment. A money guard is client-actionable
 * AND studio-recordable, so a studio that took the transfer offline can settle it
 * themselves and carry on. Hiding that button would have removed a real action,
 * which the first cut of this did.
 *
 * Advance is hidden in TWO situations, for the same reason: it cannot move and
 * something better already occupies its place. Here that is the re-share button.
 * The other is `actOnCard`: the studio is blocked and the dropzone under it IS
 * the act, worded from the same registry row as the headline, so a second dead
 * button for the same move is exactly the duplication Option D removes.
 *
 * It STAYS, disabled, in the blocked states with no dropzone: there nothing else
 * on the card names the forward move.
 *
 * At a CHOICE state there is no forward move to advance: the two endings take
 * Advance's place, once the client no longer holds the move.
 */
export function AdvanceOrReshare(props: CommandCardActionProps) {
  const th = useTranslations('engagements.hero');
  const tcmd = useTranslations('engagements.command');
  if (props.ctas.actOnCard) return null;
  if (props.view.endingChoices.length > 0 && !props.waitingOnClient) {
    // Choosing the ending is the owner's, admin's or project manager's call: any
    // other role sees who decides instead of buttons it may not press.
    if (props.view.mode === 'ready' && !props.view.endingsEnabled) {
      return (
        <p className="text-small text-[color:var(--text-muted)]">{tcmd('ending.decidedBy')}</p>
      );
    }
    return (
      <CommandCardEndings
        engagementId={props.advance.engagementId}
        endings={props.view.endingChoices}
        enabled={props.view.endingsEnabled}
        pending={props.pending}
        runAction={props.advance.runAction}
      />
    );
  }
  if (props.waitingOnClient) {
    return (
      <CommandCardWaitingClient
        engagementId={props.advance.engagementId}
        trigger={props.advance.preview.primaryTrigger}
        offlineApproval={props.ctas.offlineApproval}
        reviewAnswerOnly={
          props.view.awaitingClientReview && props.view.blockingGuards.length === 0
        }
        reviewRoundStartedAt={props.advance.reviewRoundStartedAt}
        canShare={props.canShare}
        pending={props.pending}
        onNudge={props.onNudge}
        runAction={props.advance.runAction}
      />
    );
  }
  // When Advance is blocked it must READ as disabled: a flat subdued fill, never
  // the brand CTA that looks clickable. Only the filled one is the primary action.
  const filled = props.view.advanceEnabled && props.ctas.payCta === null;
  return (
    <Button
      type="button"
      variant={filled ? 'default' : 'secondary'}
      data-primary-action={filled ? '' : undefined}
      className="w-full"
      disabled={!props.view.advanceEnabled || props.pending}
      onClick={() => fireAdvance(props)}
    >
      {props.pending && props.view.advanceEnabled && (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      )}
      {th('advance')}
    </Button>
  );
}
