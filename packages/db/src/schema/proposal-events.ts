import {
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { proposals } from './proposals';

/**
 * Append-only proposal lifecycle log (mirror audit_log's grant model: INSERT +
 * SELECT only, no UPDATE/DELETE). Records send/accept/reject/expire/supersede and
 * — for a public client decision — the actor name, IP and user agent.
 */
export const proposalEvents = pgTable(
  'proposal_events',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    proposalId: uuid('proposal_id').notNull(),
    kind: text('kind').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('proposal_events_org_id_id_unique').on(t.orgId, t.id),
    ...sameOrgFk(t, 'proposal', proposals, { onDelete: 'cascade' }),
  ],
);

export type ProposalEvent = typeof proposalEvents.$inferSelect;
export type NewProposalEvent = typeof proposalEvents.$inferInsert;
