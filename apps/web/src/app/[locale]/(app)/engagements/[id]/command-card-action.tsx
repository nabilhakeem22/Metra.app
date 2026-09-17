'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import type { CommandCardView } from '@/lib/engagements/command-card';
import type { CommandCardCtas } from '@/lib/engagements/command-card-ctas';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type { Trigger } from '@/lib/engagements/transitions';
import { AdvanceOrReshare } from './command-card-advance';

/**
 * THE one action, full width, plus the three quiet lines under it.
 *
 * An inline row of equal buttons makes the reader choose; a single wide CTA with
 * the secondary beneath it does not. Payment comes FIRST when it is due, because
 * clearing the money is what unblocks the advance underneath it.
 */
export interface CommandCardActionProps {
  view: CommandCardView;
  ctas: Pick<CommandCardCtas, 'showPayCta' | 'actOnCard'>;
  /** From the chrome: every unmet guard is one the CLIENT clears. */
  waitingOnClient: boolean;
  canShare: boolean;
  pending: boolean;
  onNudge: () => void;
  onTogglePay: () => void;
  /** Everything the Advance button needs to dispatch, or to open the fee form. */
  advance: {
    engagementId: string;
    preview: EngagementGatePreview;
    runAction: (
      fn: (idempotencyKey: string) => Promise<ActionResult>,
      trigger?: Trigger,
    ) => void;
    /** `advanceNeedsForm` edges carry a payload, so Advance opens a form instead. */
    openFeeForm: () => void;
  };
}

/** One quiet explanatory line under the action row. */
function ActionNote({ children }: { children: string }) {
  return (
    <p className="mt-3.5 flex items-baseline gap-1.5 text-[12.5px] text-[color:var(--text-muted)]">
      <span aria-hidden>◆</span>
      <span>{children}</span>
    </p>
  );
}

export function CommandCardAction(props: CommandCardActionProps) {
  const t = useTranslations('engagements');
  const th = useTranslations('engagements.hero');
  const tcmd = useTranslations('engagements.command');
  const { view, ctas, canShare, pending, waitingOnClient } = props;
  return (
    <>
      <div className="flex flex-col gap-2.5">
        {ctas.showPayCta && (
          <Button type="button" className="w-full" disabled={pending} onClick={props.onTogglePay}>
            {th('logPaymentAdvance')}
          </Button>
        )}
        <AdvanceOrReshare {...props} />
      </div>

      {/* WHAT HAPPENS NEXT — one line under the action so it never reads as a dead
          end. Only in 'ready': naming the next phase while the move is still
          blocked would promise something the button cannot do. */}
      {view.mode === 'ready' && view.nextPhaseState && (
        <p className="mt-2.5 text-center text-[12.5px] text-[color:var(--text-muted)]">
          {tcmd('advanceLeadsTo', { phase: t(`state.${view.nextPhaseState}`) })}
        </p>
      )}

      {/* The hint explains the nudge affordance. In wait mode the button IS that
          affordance and sits right above, so the line would just be the same
          sentence twice. */}
      {view.showNudge && canShare && !waitingOnClient && (
        <ActionNote>{tcmd('nudgeHint')}</ActionNote>
      )}

      {ctas.showPayCta && <ActionNote>{th('payNote')}</ActionNote>}
    </>
  );
}
