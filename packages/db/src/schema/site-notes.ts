import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { siteNoteKind } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameProjectFk } from './org-ref';
import { siteVisits } from './site-visits';

/**
 * A note from site to the studio (Stage 3, 0064): progress, an issue or a
 * request. Never shown to the client. EVIDENCE: `trg_site_notes_guard` lets an
 * UPDATE change only the void pair (once). No DELETE grant.
 */
export const siteNotes = pgTable(
  'site_notes',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').notNull(),
    visitId: uuid('visit_id').notNull(),
    clientKey: uuid('client_key').notNull(),
    authorId: uuid('author_id').notNull(),
    kind: siteNoteKind('kind').notNull(),
    body: text('body').notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
  },
  (t) => [
    unique('site_notes_org_id_id_unique').on(t.orgId, t.id),
    unique('site_notes_org_client_key_unique').on(t.orgId, t.clientKey),
    // Present = at least one visible character (the contract_cost_entries rule).
    check(
      'site_notes_body_present',
      sql`body ~ '[^[:space:]\\u00a0\\u1680\\u2000-\\u200b\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]' and char_length(body) <= 2000`,
    ),
    check('site_notes_void_pair', sql`(voided_at is null) = (voided_by is null)`),
    sameProjectFk(t, 'visit', siteVisits),
    index('site_notes_org_visit_idx').on(t.orgId, t.visitId),
  ],
);

export type SiteNote = typeof siteNotes.$inferSelect;
export type NewSiteNote = typeof siteNotes.$inferInsert;
