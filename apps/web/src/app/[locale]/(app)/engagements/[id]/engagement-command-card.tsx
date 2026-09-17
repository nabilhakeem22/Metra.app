'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { deriveCommandCard } from '@/lib/engagements/command-card';
import { resolveCommandCardChrome } from '@/lib/engagements/command-card-chrome';
import { resolveCommandCardCtas } from '@/lib/engagements/command-card-ctas';
import { isTerminal } from '@/lib/engagements/states';
import { CommandCardAction } from './command-card-action';
import { useCommandCardCopy } from './command-card-copy';
import { CommandCardForms } from './command-card-forms';
import { CommandCardHeadline } from './command-card-headline';
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
// lib/engagements/command-card-{chrome,ctas}.ts.
//
// It derives a machine-truthful view from the server gate preview
// (`deriveCommandCard`): the headline reflects what ACTUALLY blocks Advance — the
// real unmet forward guards. The client's advisory approval NEVER gates Advance.
//
// EACH FACT APPEARS ONCE. Whose move it is = the pill (never also a second line);
// what blocks Advance = the checklist row, marked ● unmet (never also a hint
// interpolation or a note under the button). The hint POINTS at the checklist and
// does not restate it; a second rendering of either is a regression.
export function EngagementCommandCard(props: EngagementCommandCardProps) {
  const { engagementId, preview, state, pending, canShare, canUpload, onNudge } = props;
  const t = useTranslations('engagements');
  const th = useTranslations('engagements.hero');
  const [feeOpen, setFeeOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const view = deriveCommandCard(preview, {
    canAdvance: props.canAdvance,
    isTerminal: isTerminal(state),
  });
  const closed = view.mode === 'closed';
  const chrome = resolveCommandCardChrome({
    mode: view.mode,
    paymentClaimCount: props.paymentClaimCount,
  });
  const ctas = resolveCommandCardCtas(preview, {
    canRecordPayment: props.canRecordPayment,
    canAdvance: props.canAdvance,
    canUpload,
    state,
    mode: view.mode,
    closed,
    conceptOptionCount: props.conceptOptionCount,
  });
  const copy = useCommandCardCopy({ state, view, closed });

  return (
    <section
      className={`glass relative overflow-hidden p-0 text-[color:var(--text)] ${chrome.borderClass}`}
    >
      <CommandCardAccentStripe className={chrome.stripeClass} />
      <CommandCardStatusBand state={state} chrome={chrome} />

      <div className="px-5 pb-5 pt-5 sm:px-6">
        {!closed && (
          <EngagementHeroBadges
            t={t}
            th={th}
            state={state}
            stallDays={props.stallDays}
            allowances={props.allowances}
          />
        )}

        <CommandCardHeadline
          closed={closed}
          copy={copy}
          clientActivity={props.clientActivity}
          awaitingReplyCount={props.awaitingReplyCount}
        />

        {!closed && (
          <>
            <CommandCardSteps
              engagementId={engagementId}
              project={{ id: props.projectId, state, boqSummary: props.boqSummary }}
              ctas={ctas}
              copy={copy}
              canUpload={canUpload}
              checklist={{
                items: preview.items,
                showNudgePill: view.showNudge && canShare,
                onNudge,
              }}
            />

            <CommandCardAction
              view={view}
              ctas={ctas}
              waitingOnClient={chrome.waitingOnClient}
              canShare={canShare}
              pending={pending}
              onNudge={onNudge}
              onTogglePay={() => setPayOpen((open) => !open)}
              advance={{
                engagementId,
                preview,
                runAction: props.runAction,
                openFeeForm: () => setFeeOpen((open) => !open),
              }}
            />

            <CommandCardForms
              engagementId={engagementId}
              preview={preview}
              view={view}
              ctas={ctas}
              open={{ fee: feeOpen, pay: payOpen }}
              offPlan={{ enabled: props.offPlan, canSet: props.canSetOffPlan }}
              pending={pending}
              handlers={{
                runAction: props.runAction,
                closeFee: () => setFeeOpen(false),
                closePay: () => setPayOpen(false),
              }}
            />

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

      {canShare && <CommandCardShareFooter onNudge={onNudge} />}
    </section>
  );
}
