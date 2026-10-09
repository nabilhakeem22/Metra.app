// PURE checklist builder (client-safe: no server-only). Each item is included
// ONLY when the role may perform it (can(role, capability, action)); `percent` is
// over the INCLUDED items so a read-only role never sees a stuck 0/5. A role with
// no create grants yields items:[] and the card shows a "you're all set" line.
import { can } from '../permissions/can';
import type {
  Capability,
  MemberRole,
  PermissionAction,
} from '../permissions/roles';
import type { OnboardingProgress } from './progress';
import { shareDeliveryHref } from './share-delivery-href';

export interface ChecklistItem {
  key: string;
  done: boolean;
  href: string;
  /** Tour step id to launch on click (null = just deep-link). */
  tourStep: string | null;
  capability: Capability;
  action: PermissionAction;
}

export interface ChecklistResult {
  items: ChecklistItem[];
  percent: number;
  allDone: boolean;
}

export function buildChecklist(
  p: OnboardingProgress,
  role: MemberRole,
  // Reserved (mirrors canSeeMargin call sites); no current item depends on it.
  hideMarginFromPm: boolean,
): ChecklistResult {
  void hideMarginFromPm;

  const all: ChecklistItem[] = [
    { key: 'completeProfile', done: p.profileComplete, href: '/settings', tourStep: null, capability: 'users_settings', action: 'update' },
    { key: 'addClient', done: p.hasClient, href: '/clients?new=1', tourStep: 'clients', capability: 'clients', action: 'create' },
    { key: 'addProject', done: p.hasProject, href: '/projects?new=1', tourStep: 'projects', capability: 'projects', action: 'create' },
    { key: 'startDelivery', done: p.hasEngagement, href: '/engagements?new=1', tourStep: 'deliveries', capability: 'engagements_design', action: 'create' },
    // Sharing mints the client link: the owner/admin `engagements_issue` approve cell.
    { key: 'shareDelivery', done: p.hasSharedDelivery, href: shareDeliveryHref(p.newestUnsharedDeliveryId), tourStep: null, capability: 'engagements_issue', action: 'approve' },
  ];

  const items = all.filter((i) => can(role, i.capability, i.action));
  const doneCount = items.filter((i) => i.done).length;
  const percent = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const allDone = items.length > 0 && doneCount === items.length;

  return { items, percent, allDone };
}
