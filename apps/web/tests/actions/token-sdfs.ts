// The public token functions, signature by signature (S1). Not a test file:
// token-sdf-lockdown.dbtest.ts holds the class-wide checks over this list.

/**
 * EVERY public token SECURITY DEFINER function, with its exact argument list. The
 * class-wide invariant (S1): a token SDF must NEVER be callable by PUBLIC or by the
 * Supabase api roles — CREATE FUNCTION grants EXECUTE to PUBLIC by DEFAULT, so
 * without an explicit revoke in rls/roles.sql anyone holding the project's anon key
 * could call these directly over PostgREST and bypass the app's own read layer. The
 * `*_respond_/_ack_/_claim_` variants additionally take caller-supplied
 * p_name/p_ip/p_ua that are written into append-only ledgers (audit poisoning).
 *
 * Table-driven ON PURPOSE: adding a new token SDF is a ONE-LINE addition here, and
 * forgetting its revoke then fails this suite instead of shipping.
 */
export const TOKEN_SDFS: ReadonlyArray<{ name: string; args: string }> = [
  // Not a public SHARE token (it backs the invitation-accept flow), but it is
  // resolved by token hash and was already locked down — included so the discovery
  // check below can be exhaustive over `app_*_by_token` with no exceptions list.
  { name: 'app_invitation_by_token', args: 'text' },
  { name: 'app_proposal_by_token', args: 'text' },
  { name: 'app_proposal_respond_by_token', args: 'text, text, text, text, text' },
  { name: 'app_contract_by_token', args: 'text' },
  { name: 'app_contract_ack_by_token', args: 'text, text, text, text, text' },
  // Stage 2 (0063): one section's lines of the token's contract, 100 at a time.
  { name: 'app_contract_section_lines_by_token', args: 'text, uuid, integer' },
  { name: 'app_variation_by_token', args: 'text' },
  { name: 'app_variation_respond_by_token', args: 'text, text, text, text, text' },
  { name: 'app_delivery_by_token', args: 'text' },
  { name: 'app_delivery_document_by_token', args: 'text, uuid' },
  // Round D (0059): the write names the issuance the client saw; its
  // six-argument predecessor is dropped (Round E, 0060).
  {
    name: 'app_delivery_respond_by_token',
    args: 'text, text, timestamptz, text, text, text, text',
  },
  {
    name: 'app_delivery_claim_payment_by_token',
    args: 'text, text, text, text, text, text',
  },
  // Client Deliverables Step 2 — per-document comment threads. The reader is in
  // this class because it returns client-authored message BODIES; the writer
  // because it takes caller-supplied p_name/p_ip/p_ua written into an append-only
  // ledger, the same audit-poisoning surface as the respond/claim variants.
  { name: 'app_delivery_document_comments_by_token', args: 'text, uuid' },
  {
    name: 'app_delivery_comment_by_token',
    args: 'text, uuid, text, text, text, text',
  },
  // Round B (0056). The concept choice takes caller-supplied p_name/p_ip/p_ua
  // written into the append-only ledger; the notifier writes notification rows
  // for every member of the delivery's org, so a direct RPC could spam a studio.
  // 0057: the choice takes the letter the client saw (the 6-argument version
  // is dropped); the predicate answers whether a client act's notification was
  // ever written, which is an oracle about the studio a direct RPC must not reach.
  {
    name: 'app_delivery_choose_concept_by_token',
    args: 'text, uuid, integer, text, text, text, text',
  },
  { name: 'app_delivery_notify_studio_by_token', args: 'text, text, jsonb, jsonb' },
  { name: 'app_delivery_act_notified_by_token', args: 'text, text, text' },
  // Round C (0058): the studio logo (a storage location in the delivery's org)
  // and the handover close target (the org and delivery ids). Both are
  // token-resolved and must not be reachable with an API key.
  { name: 'app_delivery_logo_by_token', args: 'text' },
  { name: 'app_delivery_close_target_by_token', args: 'text' },
];

/** The regprocedure text of one listed function. */
export function signatureOf(sdf: { name: string; args: string }): string {
  return `public.${sdf.name}(${sdf.args})`;
}
