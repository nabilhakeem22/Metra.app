import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { designEngagements } from './design-engagements';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * One one-time code a client asked for on their home (0065, DB step C), bound
 * to (delivery, purpose, target). The app makes the code and its challenge id
 * (`id`), emails the code, and the database keeps only `code_hash` =
 * sha256(`id:code`); the raw code is never stored.
 *
 * Written ONLY by the client home's definer functions (rls/functions/
 * 75-client-home.sql): metra_app may read every column but `code_hash`, and
 * write none (rls/roles.sql). trg_client_verification_codes_guarded admits
 * only a wrong try (`attempts` + 1) or the one consumption (`consumed_at` and
 * `result_ref` together, once), and a delete only from the delivery's cascade.
 *
 * `destination_hash` is sha256 of the lower-cased address the code went to and
 * `destination_hint` what the client was shown of it: evidence of where the
 * code went, without the address. `result_ref` is the row the act wrote (the
 * contract_events, variation_order_events or claim id).
 */
export const clientVerificationCodes = pgTable(
  'client_verification_codes',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    engagementId: uuid('engagement_id').notNull(),
    purpose: text('purpose').notNull(),
    targetKey: text('target_key').notNull(),
    channel: text('channel').notNull().default('email'),
    destinationHash: text('destination_hash').notNull(),
    destinationHint: text('destination_hint').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    resultRef: uuid('result_ref'),
    actorIp: text('actor_ip'),
    actorUserAgent: text('actor_user_agent'),
  },
  (t) => [
    unique('client_verification_codes_org_id_id_unique').on(t.orgId, t.id),
    check(
      'client_verification_codes_purpose_known',
      sql`purpose in ('sign_contract', 'decide_variation', 'claim_request', 'claim_design_payment')`,
    ),
    check('client_verification_codes_target_key_length', sql`char_length(target_key) between 1 and 64`),
    check('client_verification_codes_channel_known', sql`channel in ('email')`),
    check(
      'client_verification_codes_hashes_shape',
      sql`destination_hash ~ '^[0-9a-f]{64}$' and code_hash ~ '^[0-9a-f]{64}$'`,
    ),
    check('client_verification_codes_hint_length', sql`char_length(destination_hint) between 1 and 80`),
    check('client_verification_codes_attempts_range', sql`attempts between 0 and 5`),
    check(
      'client_verification_codes_life',
      sql`expires_at > created_at and expires_at <= created_at + interval '10 minutes'`,
    ),
    check('client_verification_codes_consumed_pair', sql`(consumed_at is null) = (result_ref is null)`),
    check(
      'client_verification_codes_actor_length',
      sql`char_length(actor_ip) <= 45 and char_length(actor_user_agent) <= 512`,
    ),
    // `index: false`: client_verification_codes_engagement_idx below IS the
    // (org_id, engagement_id) index this helper would make, widened to the
    // per-target issue limits' columns.
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade', index: false }),
    index('client_verification_codes_engagement_idx').on(
      t.orgId,
      t.engagementId,
      t.purpose,
      t.targetKey,
      t.createdAt.desc().nullsFirst(),
    ),
    // The platform's daily ceiling counts every studio's codes of the last day.
    index('client_verification_codes_created_idx').on(t.createdAt),
  ],
);

export type ClientVerificationCode = typeof clientVerificationCodes.$inferSelect;
