'use client';

import { MailWarning } from 'lucide-react';
import { StepCard, StepHeadline } from '@/components/flow/step-card';
import { resolveCommandCardChrome } from '@/lib/engagements/command-card-chrome';
import { buildPhaseView } from '@/lib/flow/build-view';
import { locateExecutionForStudio } from '@/lib/flow/locate/execution-studio';
import { EXECUTION_PHASE } from '@/lib/flow/phases/execution';
import { CommandCardActionError } from './command-card-action-error';
import { CommandCardClosedClaims } from './command-card-closed-claims';
import { ExecutionNextAction, ExecutionRecordLinks } from './command-card-execution';
import type { EngagementCommandCardProps, ExecutionCockpit } from './command-card-props';
import { DesignSummaryLine } from './design-summary-line';
import { ExecutionPhaseRail } from './execution-phase-rail';
import { useExecutionStepCopy } from './execution-step-copy';

/** The command card props this card reads. */
export type ExecutionStepCardProps = Pick<
  EngagementCommandCardProps,
  'status' | 'clientHasEmail' | 'pending' | 'paymentClaims' | 'canResolveClaims' | 'runAction' | 'actionError' | 'onOpenTab'
>;

// The cockpit's STEP CARD AT EXECUTION: the same shared card the design phase
// wears, now on the execution phase. Its band holds the finished design folded
// into one line, then the five execution steps with whose move each is; its
// body names the ONE next action (lib/execution/stage.ts) and offers it, with
// "Record costs" and "Record measurements" beside it. A client payment claim
// left on the finished design is still dismissed here, as it was before.
// Composition only: the copy is execution-step-copy.ts, the controls
// command-card-execution.tsx, the rail execution-phase-rail.tsx.
export function ExecutionStepCard({ card, execution }: { card: ExecutionStepCardProps; execution: ExecutionCockpit }) {
  const { view, designSummary } = execution;
  const location = locateExecutionForStudio(view);
  const copy = useExecutionStepCopy({ view, location, clientHasEmail: card.clientHasEmail });

  return (
    <StepCard
      chrome={resolveCommandCardChrome(card.status)}
      rail={
        <>
          <DesignSummaryLine
            summary={designSummary}
            status={card.status}
            pending={card.pending}
            onOpenTab={card.onOpenTab}
          />
          <ExecutionPhaseRail view={buildPhaseView(EXECUTION_PHASE, location, 'studio')} />
        </>
      }
    >
      <div className="space-y-4" data-execution-stage={view.stage}>
        <div>
          <StepHeadline eyebrow={copy.eyebrow} headline={copy.headline} hint={copy.hint} />
          {copy.noEmailNotice && (
            <p
              data-no-email-notice
              className="flex items-start gap-2 rounded-item border border-[color:var(--warn-tint)] bg-[color:var(--track)] px-3 py-2.5 text-small text-[color:var(--text)]"
            >
              <MailWarning className="mt-0.5 size-4 shrink-0 text-[color:var(--warn)]" aria-hidden />
              {copy.noEmailNotice}
            </p>
          )}
        </div>
        {view.next && copy.actionLabel && (
          <ExecutionNextAction view={view} kind={view.next.kind} label={copy.actionLabel} />
        )}
        <ExecutionRecordLinks view={view} />
        <CommandCardActionError error={card.actionError} />
        {card.canResolveClaims && (
          <CommandCardClosedClaims claims={card.paymentClaims} pending={card.pending} runAction={card.runAction} />
        )}
      </div>
    </StepCard>
  );
}
