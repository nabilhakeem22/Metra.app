// The catalogue of NARROWED tables whose table-level grants `verifyRlsApplied`
// reads back, with the privilege each narrowing exists to remove.
import type { TablePrivilege } from './roles-grants';

/**
 * The tables whose TABLE-LEVEL grants are read back, and why these.
 *
 * Every one of them is a NARROWING that `rls/roles.sql` performs with a `revoke`,
 * and a revoke only converges if it RAN. Four of the five lines exist purely to
 * remove a privilege from databases provisioned before the narrowing was written
 * — which means the databases where they matter are exactly the ones where
 * reading the file tells you nothing.
 *
 *   boqs                          no DELETE — an issued BOQ is the priced record
 *                                 a contract is generated from; deleting one
 *                                 deletes the evidence.
 *   engagement_milestones         INSERT-only — under the "absent milestone =
 *                                 free gate" rule, an UPDATE or DELETE here
 *                                 waives a PAYING gate.
 *   document_categories           no DELETE — files point at a category, and
 *                                 retiring one must not pull it out from under
 *                                 them.
 *   engagement_document_comments  append-only — neither side may edit or retract
 *                                 a message once sent, which is what makes the
 *                                 thread the record of what the client asked for.
 *   workspace_entitlements        INSERT-only — an UPDATE here is a member
 *                                 granting themselves a flow or raising a limit.
 *   market_categories, market_items, market_bulletins,
 *   market_price_observations,
 *   market_item_details,
 *   market_seed_book              SELECT-only (0061, 0062) — official guide prices
 *                                 every studio reads; only the owner's
 *                                 `market:publish` CLI writes them, as the
 *                                 connection role. A metra_app write would let
 *                                 one studio change what every studio sees.
 *   contract_payments,
 *   contract_line_measurements    append-only (0063) — a recorded payment and a
 *                                 site reading are never edited or removed; a
 *                                 correction is a new reading.
 *   payment_requests              no DELETE (0063) — a request is voided,
 *                                 never deleted.
 *   contract_payment_claims       SELECT only at table level (DB step B): only
 *                                 the client's link function writes a claim,
 *                                 and the studio's answer is a column-level
 *                                 UPDATE, read back by ./column-grants.ts;
 *                                 never deleted.
 *   contract_cost_entries         no DELETE (0063) and no TABLE-LEVEL UPDATE
 *                                 (DB step B): a cost is voided, never deleted,
 *                                 and its UPDATE is column-level, read back by
 *                                 ./column-grants.ts.
 *   project_assignments,
 *   site_location_consents,
 *   site_devices,
 *   site_visits, site_photos,
 *   site_material_receipts,
 *   site_notes                    no DELETE (0064) — an assignment, a consent
 *                                 and a device end by a stamp; a site diary row
 *                                 is evidence, voided at most, never deleted.
 *
 * `design_engagements` is NOT in this list: its authority is column-level and is
 * read back separately by `designEngagementUpdateProblems`, which is a different
 * question.
 *
 * Extending this to every table in roles.sql is one line and is deliberately not
 * done here: each addition is a new way for `apply-rls` to fail on a database
 * nobody can test against first, and these five are the narrowings the wave asked
 * for.
 *
 * THE VALUE IS THE PRIVILEGE THAT MUST NOT BE THERE, and it is written down
 * rather than derived. The comparison in ./verify-rls-narrowed-grants.ts is
 * against roles.sql, which follows whatever roles.sql says — so an edit that
 * re-granted `delete on boqs` would move BOTH sides and stay green. This list does not move. It is the invariant;
 * roles.sql is the implementation of it.
 */
export const NARROWED_TABLES: Record<string, readonly TablePrivilege[]> = {
  boqs: ['delete'],
  document_categories: ['delete'],
  engagement_document_comments: ['update', 'delete'],
  engagement_milestones: ['update', 'delete'],
  market_bulletins: ['insert', 'update', 'delete'],
  market_categories: ['insert', 'update', 'delete'],
  market_item_details: ['insert', 'update', 'delete'],
  market_items: ['insert', 'update', 'delete'],
  market_price_observations: ['insert', 'update', 'delete'],
  market_seed_book: ['insert', 'update', 'delete'],
  workspace_entitlements: ['update', 'delete'],
  contract_line_measurements: ['update', 'delete'],
  contract_payment_claims: ['insert', 'update', 'delete'],
  contract_payments: ['update', 'delete'],
  contract_cost_entries: ['update', 'delete'],
  payment_requests: ['delete'],
  project_assignments: ['delete'],
  site_location_consents: ['delete'],
  site_devices: ['delete'],
  site_visits: ['delete'],
  site_photos: ['delete'],
  site_material_receipts: ['delete'],
  site_notes: ['delete'],
  client_verification_codes: ['insert', 'update', 'delete'],
};
