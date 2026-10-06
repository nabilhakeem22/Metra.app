'use client';

import { useTranslations } from 'next-intl';
import { CommandCardActRegion } from './command-card-act-region';
import { CommandCardClosedClaims } from './command-card-closed-claims';
import { CommandCardClosedLinks } from './command-card-closed-links';
import { useCommandCardCopy } from './command-card-copy';
import { CommandCardHeadline } from './command-card-headline';
import { deriveCommandCardModel } from './command-card-model';
import type { EngagementCommandCardProps } from './command-card-props';
import {
  CommandCardAccentStripe,
  CommandCardShareFooter,
  CommandCardStatusBand,
} from './command-card-status-band';
import { CommandCardSteps } from './command-card-steps';
import { EngagementHeroBadges } from './engagement-hero-badges';
import { EngagementSecondaryActions } from './engagement-secondary-actions';

// The cockpit COMMAND CARD — the single "what's next" surface, as a stacked card.
// COMPOSITION ONLY: each numbered section is the file named after it
// (command-card-{status-band,headline,steps,action,forms}.tsx), and which chrome
// the card wears and which controls it offers are pure, tested functions in
// lib/engagements/command-card-{chrome,ctas}.ts, wired in command-card-model.ts.
//
// It derives a machine-truthful view from the server gate preview
// (`deriveCommandCard`): the headline reflects what ACTUALLY blocks Advance — the
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
    <section
      className={`glass relative overflow-hidden p-0 text-[color:var(--text)] ${chrome.borderClass}`}
    >
      <CommandCardAccentStripe className={chrome.stripeClass} />
      <CommandCardStatusBand state={state} />

      <div className="px-5 pb-5 pt-5 sm:px-6">
        {!closed && (
          <EngagementHeroBadges th={th} state={state} allowances={props.allowances} />
        )}

        <CommandCardHeadline
          closed={closed}
          copy={copy}
          clientActivity={props.clientActivity}
          awaitingReplyCount={props.awaitingReplyCount}
        />

        {closed && (
          <CommandCardClosedLinks
            state={state}
            projectId={props.projectId}
            canStartQuotation={props.canStartQuotation}
          />
        )}

        {closed && props.canResolveClaims && (
          <CommandCardClosedClaims
            claims={props.paymentClaims}
            pending={pending}
            runAction={props.runAction}
          />
        )}

        {!closed && (
          <>
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

            <CommandCardActRegion card={props} model={{ view, ctas }} />

            {/* 3. FOOTER — client link + the "more actions" secondary controls. */}
            <EngagementSecondaryActions
              engagementId={engagementId}
              triggers={props.secondaryTriggers}
              allowances={props.allowances}
              pending={pending}
              runAction={props.runAction}
            />
          </>
        )}
      </div>

      {/* A closed delivery has nobody left to nudge. */}
      {canShare && !closed && <CommandCardShareFooter onNudge={onNudge} />}
    </section>
  );
}
