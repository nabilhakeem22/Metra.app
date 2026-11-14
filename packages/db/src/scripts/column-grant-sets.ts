// The column lists behind the narrowed UPDATE grants, written down as the
// INVARIANT. rls/roles.sql is their implementation: an edit that widened a
// grant there would move roles.sql and stay red against these.
//
// Read by ./column-grants.ts (the database read-back after apply-rls) and by
// apps/web/src/lib/db/narrowed-update-grants.test.ts (the app's update sites
// against roles.sql, with no database). Names only: no fs, no postgres.

/** The cost entry columns an edit and a void write (lib/execution/costs). */
export const COST_ENTRY_UPDATE_COLUMNS: ReadonlySet<string> = new Set([
  'contract_section_id',
  'contract_line_id',
  'cost_item_id',
  'category',
  'description',
  'qty',
  'unit',
  'unit_cost',
  'amount',
  'incurred_on',
  'supplier',
  'reference',
  'voided_at',
  'voided_by',
  'updated_at',
]);

/** The claim columns a confirm and a dismiss write (lib/execution/claims). */
export const CLAIM_UPDATE_COLUMNS: ReadonlySet<string> = new Set([
  'status',
  'confirmed_payment_id',
  'resolved_by',
  'resolved_at',
  'updated_at',
]);

/**
 * The design-payment claim columns a confirm and a dismiss write
 * (lib/engagements/payment-claims.ts): the studio's answer, never what the
 * client claimed (security batch 3, A5).
 */
export const CLIENT_CLAIM_UPDATE_COLUMNS: ReadonlySet<string> = new Set([
  'status',
  'confirmed_payment_event_id',
  'resolved_by',
  'resolved_at',
  'updated_at',
]);

/**
 * The API key columns a revoke writes (lib/api-keys): never `created_by`,
 * whose live role the key resolves through (security batch 3, A5).
 */
export const API_KEY_UPDATE_COLUMNS: ReadonlySet<string> = new Set(['revoked_at', 'updated_at']);
