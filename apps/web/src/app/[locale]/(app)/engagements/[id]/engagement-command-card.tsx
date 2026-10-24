'use client';

import { useTranslations } from 'next-intl';
import { StepCard } from '@/components/flow/step-card';
import { ClientExpectedDate } from './client-expected-date';
import { CommandCardActRegion } from './command-card-act-region';
import { CommandCardActionError } from './command-card-action-error';
import { CommandCardClosedClaims } from './command-card-closed-claims';
import { CommandCardExecution } from './command-card-execution';
import { useCommandCardCopy } from './command-card-copy';
import { CommandCardHeadline } from './command-card-headline';
import { deriveCommandCardModel } from './command-card-model';
import type { EngagementCommandCardProps } from './command-card-props';
import { CommandCardSteps } from './command-card-steps';
import { EngagementHeroBadges } from './engagement-hero-badges';
import { EngagementSecondaryActions } from './engagement-secondary-actions';
import { EngagementStageSpine } from './engagement-stage-spine';

// The cockpit COMMAND CARD: the single "what's next" surface, as a stacked card.
// COMPOSITION ONLY: it wears the shared step card (components/flow/step-card.tsx)
// with the stage spine as its rail, each numbered section is the file named
// after it (command-card-{headline,steps,action,forms}.tsx), and which chrome
// the card wears and which controls it offers are pure, tested functions in
// lib/engagements/command-card-{chrome,ctas}.ts, wired in command-card-model.ts.
//
// It derives a machine-truthful view from the server gate preview
// (`deriveCommandCard`): the headline reflects what ACTUALLY blocks Advance: the
// real unmet forward guards. The client's advisory approval NEVER gates Advance.
//
// EACH FACT APPEARS ONCE. Whose move it is = the header's status chip (the card
// only wears its colour); what blocks Advance = the checklist row, marked ● unmet
// (never also a hint interpolation or a note under the button). The hint POINTS
// at the checklist and does not restate it; a second rendering of either is a
// regression.
export function EngagementCommandCard(props: EngagementCommandCardProps) {
  const { engagementId, preview, state, pending, canShare, canUpload, onNudge } = props;
  const th = useTranslations('engagements.hero');
  const { view, closed, chrome, ctas } = deriveCommandCardModel(props);
  const copy = useCommandCardCopy({ state, view, closed });

  return (
    <StepCard chrome={chrome} rail={<EngagementStageSpine state={state} status={props.status} />}>
      {!closed && (
        <EngagementHeroBadges th={th} state={state} allowances={props.allowances} />
      )}

      <CommandCardHeadline
        closed={closed}
        copy={copy}
        clientActivity={props.clientActivity}
        review={{ state, clientDecision: preview.clientDecision }}
        awaitingReplyCount={props.awaitingReplyCount}
      />

      {closed && props.execution && <CommandCardExecution view={props.execution} />}

      {closed && props.canResolveClaims && (
        <CommandCardClosedClaims
          claims={props.paymentClaims}
          pending={pending}
          runAction={props.runAction}
        />
      )}

      {closed && <CommandCardActionError error={props.actionError} />}

      {!closed && (
        <>
          {/* 2. THE ACT first, then what stands behind it: the move the studio
              came here to make sits above the fold, the checklist explains it. */}
          <div className="mb-5">
            <CommandCardActRegion card={props} model={{ view, ctas }} />
            <CommandCardActionError error={props.actionError} />
            {props.clientExpected && (
              <ClientExpectedDate
                key={props.clientExpected.view.kind === 'none' ? 'none' : props.clientExpected.view.on}
                engagementId={engagementId}
                card={props.clientExpected}
                pending={pending}
                runAction={props.runAction}
              />
            )}
          </div>

          <CommandCardSteps
            engagementId={engagementId}
            project={{ id: props.projectId, state, boqStep: props.boqStep }}
            ctas={ctas}
            copy={copy}
            canUpload={canUpload}
            checklist={{
              items: preview.items,
              showNudgePill: view.showNudge && canShare,
              onNudge,
            }}
          />

          {/* 3. The "more actions" secondary controls. */}
          <EngagementSecondaryActions
            engagementId={engagementId}
            triggers={props.secondaryTriggers}
            allowances={props.allowances}
            pending={pending}
            runAction={props.runAction}
          />
        </>
      )}
    </StepCard>
  );
}
