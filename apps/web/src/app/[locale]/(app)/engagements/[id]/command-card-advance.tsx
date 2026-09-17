'use client';

import { Link2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { CommandCardActionProps } from './command-card-action';
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
 * WAITING ON THE CLIENT: the ADVANCE is dead machinery — nothing the studio does
 * enables it, only the client acting does — so it is replaced by the one move they
 * can still make on this card.
 *
 * Note what is NOT hidden: logging a payment. A money guard is client-actionable
 * AND studio-recordable, so a studio that took the transfer offline can settle it
 * themselves and carry on. Hiding that button would have removed a real action,
 * which the first cut of this did.
 *
 * Advance is hidden in TWO situations, for the same reason: it cannot move and
 * something better already occupies its place. Here that is the re-share button.
 * The other is `actOnCard` — the studio is blocked and the dropzone above IS the
 * act, worded from the same registry row as the headline, so a second dead button
 * for the same move is exactly the duplication Option D removes.
 *
 * It STAYS, disabled, in the blocked states with no dropzone: there nothing else
 * on the card names the forward move.
 */
export function AdvanceOrReshare(props: CommandCardActionProps) {
  const th = useTranslations('engagements.hero');
  const tcmd = useTranslations('engagements.command');
  if (props.ctas.actOnCard) return null;
  if (props.waitingOnClient) {
    return (
      props.canShare && (
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={props.pending}
          onClick={props.onNudge}
        >
          <Link2 className="size-4" aria-hidden />
          {tcmd('reshare')}
        </Button>
      )
    );
  }
  return (
    <Button
      type="button"
      // When Advance is blocked it must READ as disabled — a flat subdued fill,
      // never the brand CTA that looks clickable.
      variant={props.view.advanceEnabled && !props.ctas.showPayCta ? 'default' : 'secondary'}
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
