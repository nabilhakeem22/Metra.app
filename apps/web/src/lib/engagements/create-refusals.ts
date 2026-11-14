// What a named constraint's refusal means when a delivery is started: the races
// createEngagementCore's reads can lose, each answered under the field it is about.
import type { ConstraintRefusal } from '@/lib/actions/mutation-failure';

/**
 * The races the reads in core.ts (createEngagementCore) can lose, each under the
 * select it is about. The one-active-delivery backstop index (migration 0032): a
 * concurrent create won the project's single active slot, the same answer the
 * read-guard gives. The composite same-org FKs: the client or project was
 * deleted between the read and the insert. Any other 23505 stays in the logged
 * tail.
 */
export const CREATE_REFUSALS = [
  {
    constraint: 'design_engagements_one_active_per_project_uniq',
    field: 'projectId',
    error: { code: 'project_delivery_exists' },
  },
  {
    constraint: 'design_engagements_client_same_org_fk',
    field: 'clientId',
    error: { code: 'no_longer_exists' },
  },
  {
    constraint: 'design_engagements_project_same_org_fk',
    field: 'projectId',
    error: { code: 'no_longer_exists' },
  },
] as const satisfies readonly ConstraintRefusal[];
