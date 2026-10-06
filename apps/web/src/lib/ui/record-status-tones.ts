// PURE and client-safe: the StatusChip tone of every record status the app
// lists. Each map is total over its DB enum (the types are erased imports), so
// a new status fails `tsc` here instead of falling back to a silent default.
// Brand only where the studio holds the next step; red never: a refusal or a
// termination is a fact to read, not an error.
import type { ContractStatus, ProjectStatus, ProposalStatus } from '@metra/db';
import type { DesignState } from '@/lib/engagements/states';
import type { VariationStatusKey } from '@/lib/variations/status-label';
import type { StatusTone } from './status-tone';

export const PROPOSAL_STATUS_TONE: Record<ProposalStatus, StatusTone> = {
  draft: 'draft',
  sent: 'waiting',
  accepted: 'done',
  rejected: 'neutral',
  expired: 'stalled',
  superseded: 'neutral',
};

export const CONTRACT_STATUS_TONE: Record<ContractStatus, StatusTone> = {
  draft: 'draft',
  issued: 'waiting',
  signed: 'done',
  terminated: 'neutral',
};

export const VARIATION_STATUS_TONE: Record<VariationStatusKey, StatusTone> = {
  draft: 'draft',
  internal_approved: 'yourMove',
  issued: 'waiting',
  approved: 'done',
  rejected: 'neutral',
  rejected_on_termination: 'neutral',
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, StatusTone> = {
  draft: 'draft',
  active: 'neutral',
  on_hold: 'neutral',
  completed: 'done',
  cancelled: 'neutral',
};

export const DESIGN_STATE_TONE: Record<DesignState, StatusTone> = {
  created: 'draft',
  design_proposal: 'neutral',
  survey: 'neutral',
  layout: 'neutral',
  concept_review: 'neutral',
  negotiation: 'neutral',
  design_3d: 'neutral',
  final_approval: 'neutral',
  shop_drawings: 'neutral',
  boq: 'neutral',
  execution_decision: 'neutral',
  design_only_handoff: 'neutral',
  closed_design_only: 'done',
  execution: 'done',
  abandoned: 'neutral',
  change_triage: 'neutral',
};
