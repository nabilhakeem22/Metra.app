// PURE (client-safe: no server-only). The studio's SETUP LADDER: a delivery
// needs a project, and a project needs a client, so the dashboard points at the
// first of those that is missing, and only with a link the role may follow. The
// last rung is sharing the first delivery with its client.
import { can } from '../permissions/can';
import { shareDeliveryHref } from '../onboarding/share-delivery-href';
import type { MemberRole } from '../permissions/roles';
import type { PrimaryCta } from './primary-cta';

/** The facts the ladder reads (a subset of the onboarding progress). */
export interface SetupProgress {
  hasClient: boolean;
  hasProject: boolean;
  hasEngagement: boolean;
  hasSharedDelivery: boolean;
  newestUnsharedDeliveryId: string | null;
}

const ADD_CLIENT: PrimaryCta = { messageKey: 'ctaAddClient', href: '/clients?new=1' };
const ADD_PROJECT: PrimaryCta = { messageKey: 'ctaAddProject', href: '/projects?new=1' };
const START_DELIVERY: PrimaryCta = { messageKey: 'ctaStartDelivery', href: '/engagements?new=1' };

/**
 * The next setup step, or null when setup is done or the role may not take the
 * step that is missing. It never skips ahead: without a client there is no
 * project to add, so a role that cannot add the client gets no step at all.
 */
export function nextSetupStep(role: MemberRole, progress: SetupProgress): PrimaryCta | null {
  if (!progress.hasClient) return can(role, 'clients', 'create') ? ADD_CLIENT : null;
  if (!progress.hasProject) return can(role, 'projects', 'create') ? ADD_PROJECT : null;
  if (!progress.hasEngagement) {
    return can(role, 'engagements_design', 'create') ? START_DELIVERY : null;
  }
  // Sharing mints the client link: owner/admin only (`engagements_issue`).
  if (!progress.hasSharedDelivery && can(role, 'engagements_issue', 'approve')) {
    return { messageKey: 'ctaShareDelivery', href: shareDeliveryHref(progress.newestUnsharedDeliveryId) };
  }
  return null;
}

/** Why the deliveries panel is empty: a missing prerequisite, nothing yet, or all closed. */
export type DeliveriesEmptyReason = 'noClient' | 'noProject' | 'noDelivery' | 'allClosed';

export interface DeliveriesEmptyState {
  reason: DeliveriesEmptyReason;
  cta: PrimaryCta | null;
}

/**
 * What the dashboard's deliveries panel says when nothing is in flight, and
 * where it points. "Every delivery is closed" only when one ever existed;
 * otherwise the first missing prerequisite, with its setup step.
 */
export function deliveriesEmptyState(
  role: MemberRole,
  progress: SetupProgress,
): DeliveriesEmptyState {
  if (progress.hasEngagement) {
    return {
      reason: 'allClosed',
      cta: can(role, 'engagements_design', 'create') ? START_DELIVERY : null,
    };
  }
  const reason: DeliveriesEmptyReason = !progress.hasClient
    ? 'noClient'
    : !progress.hasProject
      ? 'noProject'
      : 'noDelivery';
  return { reason, cta: nextSetupStep(role, progress) };
}
