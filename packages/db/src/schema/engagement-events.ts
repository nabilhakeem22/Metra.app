import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { designEngagements } from './design-engagements';
import { engagementEventKind } from './enums';
import { money } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Append-only engagement approvals ledger (Design-Engagement Machine, Step 7).
 * Grant model: SELECT + INSERT only (no UPDATE/DELETE) — mirrors contract_events
 * and payment_events. One row per recorded decision on an engagement: Step 7
 * writes only `concept_approval` (the concept selection that opens negotiation),
 * but the FULL `engagement_event_kind` set is declared now to avoid a later
 * enum-add migration.
 *
 * `actorUserId` is the internal actor (nullable — null on the tokenized client-ack
 * path, where no internal user is present). `actorName` / `actorIp` /
 * `actorUserAgent` carry the session-less client's provenance on that same path
 * (Client Delivery Portal Phase 2, `actorChannel = 'client'`). `rangeLow` /
 * `rangeHigh` snapshot the acknowledged `rom_acknowledgement` band. `docHash` /
 * `note` are optional provenance. Cascade delete follows the parent engagement.
 */
export const engagementEvents = pgTable(
  'engagement_events',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    engagementId: uuid('engagement_id').notNull(),
    kind: engagementEventKind('kind').notNull(),
    // Who recorded this event: 'staff' (an internal user, the default for every
    // existing writer) or 'client' (the session-less delivery-portal token path).
    // Client signals are append-only advisory witnesses — they move no state. A
    // partial UNIQUE index (0033) enforces one client signal per (engagement, kind).
    actorChannel: text('actor_channel').notNull().default('staff'),
    // The internal actor. Nullable — reserved for the future tokenized client-ack
    // path, where the decision is made by a client with no internal user row.
    actorUserId: uuid('actor_user_id'),
    // Reserved for the tokenized client-ack path (who/where acknowledged).
    actorName: text('actor_name'),
    actorIp: text('actor_ip'),
    actorUserAgent: text('actor_user_agent'),
    // Reserved for `rom_acknowledgement`: the acknowledged range (scale-4 money).
    rangeLow: money('range_low'),
    rangeHigh: money('range_high'),
    // Step 13 — `as_built_attestation` only: true = variance flagged (opens the
    // change_triage detour), false = clean attestation. NULL for every other kind.
    hasVariance: boolean('has_variance'),
    docHash: text('doc_hash'),
    note: text('note'),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('engagement_events_org_id_id_unique').on(t.orgId, t.id),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade' }),
    index('engagement_events_org_engagement_kind_idx').on(
      t.orgId,
      t.engagementId,
      t.kind,
    ),
  ],
);

export type EngagementEvent = typeof engagementEvents.$inferSelect;
export type NewEngagementEvent = typeof engagementEvents.$inferInsert;
