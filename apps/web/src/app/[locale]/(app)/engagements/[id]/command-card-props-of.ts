// The command card's props, assembled from what the page loaded. A plain module
// (no React, no 'use client'): the cockpit body composes the card, this names
// how each of its props is derived, so the body stays a composition.
import type { ActionCode } from '@/lib/actions/result';
import { countConceptOptions } from '@/lib/engagements/concept-options';
import { secondaryTriggersOf } from '@/lib/engagements/forward-trigger';
import { reviewRoundStartedAt } from '@/lib/engagements/review-round';
import type { EngagementCommandCardProps } from './command-card-props';
import type { EngagementDetailProps } from './engagement-detail-props';
import { openDeliveryReminder } from './share-anchor';
import type { RunAction } from './use-engagement-action';

export function commandCardPropsOf(
  detail: EngagementDetailProps,
  action: { pending: boolean; runAction: RunAction; actionError: ActionCode | null },
): EngagementCommandCardProps {
  const { header } = detail;
  return {
    engagementId: header.id,
    projectId: header.projectId,
    boqStep: detail.boqStep,
    preview: detail.gatePreview,
    state: header.state,
    allowances: {
      revisionCount: header.revisionCount,
      freeRevisionN: header.freeRevisionN,
      designRevisionCount: header.designRevisionCount,
      freeDesignRevisionN: header.freeDesignRevisionN,
    },
    status: detail.status,
    canAdvance: detail.canAdvance,
    canRecordOfflineApproval: detail.canRecordOfflineApproval,
    reviewRoundStartedAt: reviewRoundStartedAt({
      state: header.state,
      rendersReadyAt: header.rendersReadyAt,
      enteredConceptReviewAt:
        detail.transitions.find((transition) => transition.toState === 'concept_review')
          ?.decidedAt ?? null,
      createdAt: header.createdAt,
    }).toISOString(),
    canRecordPayment: detail.capabilities.recordPayment,
    canResolveClaims: detail.canResolveClaims,
    canShare: detail.canShare,
    canStartQuotation: detail.canStartQuotation,
    canUpload: detail.canUpload,
    canSetOffPlan: detail.capabilities.setRom,
    offPlan: header.offPlan,
    feeSplitPrefill: detail.feeSplitPrefill,
    paymentClaims: detail.paymentClaims,
    awaitingReplyCount: detail.awaitingReplyCount,
    // Pure derivation over the artifacts the page already loaded (no extra read).
    // The card needs it to stop offering a 5th concept-option upload — artifacts
    // are append-only, so overshooting the guard's cap is unrecoverable.
    conceptOptionCount: countConceptOptions(detail.artifacts),
    clientActivity: detail.clientActivity,
    // The Advance button owns the forward-advance trigger and the ending buttons
    // own the endings; every OTHER legal, permitted trigger becomes a
    // low-emphasis secondary control.
    secondaryTriggers: secondaryTriggersOf(detail.nextActions, detail.gatePreview.primaryTrigger),
    pending: action.pending,
    runAction: action.runAction,
    actionError: action.actionError,
    // The nudge pill and the waiting card remind the client with the link they
    // already hold (B11); the header's menu still opens the link itself.
    onNudge: openDeliveryReminder,
  };
}
