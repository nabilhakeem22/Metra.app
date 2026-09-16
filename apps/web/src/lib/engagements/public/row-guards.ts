// What the portal will and will not render from an UNTRUSTED jsonb snapshot.
//
// PURE and unit-testable — no `server-only`, no db, no imports beyond the two
// enums these guards check against. They lived inside the 409-line `public.ts`
// where the only way to exercise them was to drive a mocked database through
// `getDeliveryByToken`; they are the part of that file most worth proving
// directly, because every one of them exists to stop a malformed row reaching a
// client's screen.
//
// The posture is the same in all three: a row is renderable only when it carries
// the fields the portal dereferences. Anything else — a null hole, a stray shape,
// an enum value added to the database but not yet mapped — is DROPPED, never
// rendered. Dropping one row shows the client a slightly shorter list; trusting
// it shows them an unnamed file or crashes the page.
import type { EngagementArtifactKind } from '@metra/db';
import { isClientDocumentKind } from '../portal-documents';
import { DESIGN_STATES } from '../states';
import type { PublicDeliveryMilestone } from './types';

/**
 * The raw jsonb shape the SDF returns (snake_case, matches app_delivery_by_token).
 * Typed as UNTRUSTED: every field is optional/nullable because this is external
 * jsonb — the read path treats a missing/wrong-typed field as absent and degrades
 * to null rather than trusting the shape. `getDeliveryByToken` is the sole guard
 * that turns this into the strict, client-safe `PublicDelivery`.
 */
export interface DeliverySnapshot {
  id?: string | null;
  number?: number | null;
  state?: string | null;
  off_plan?: boolean | null;
  title_ar?: string | null;
  title_en?: string | null;
  created_at?: string | null;
  design_fee_total?: string | null;
  rom?: { low?: string | null; high?: string | null } | null;
  share_expires_at?: string | null;
  firm?: { name_ar?: string | null; name_en?: string | null; logo_file_id?: string | null } | null;
  client?: { name_ar?: string | null; name_en?: string | null } | null;
  payment_schedule?: PublicDeliveryMilestone[] | null;
  documents?: Array<DeliveryDocumentRow | null> | null;
  client_actions?: string[] | null;
  claim?: {
    claimable_milestones?: Array<{
      milestone_kind?: string | null;
      amount_remaining?: string | null;
      has_pending_claim?: boolean | null;
    } | null> | null;
  } | null;
}

/** One raw document row from the SDF `documents` array. */
export interface DeliveryDocumentRow {
  id: string;
  kind: EngagementArtifactKind;
  shared_at?: string | null;
  comment_count?: number | null;
  access?: string | null;
}

/**
 * A document row is renderable only when it carries a non-empty string `id` (the
 * download route's filter) AND a `kind` the portal has a client-facing category
 * for. Anything else (a null hole, a stray shape, a kind added to the DB enum but
 * not yet mapped) is dropped — never rendered — so a malformed row can neither
 * crash nor show the client an unnamed file. Same defensive posture as
 * isRenderableMilestone. `shared_at` is read null-safe.
 */
export function isRenderableDocument(row: unknown): row is DeliveryDocumentRow {
  if (!row || typeof row !== 'object') return false;
  const candidate = row as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    isClientDocumentKind(candidate.kind)
  );
}

/** One raw claimable-milestone row from the SDF `claim.claimable_milestones`. */
export interface ClaimableMilestoneRow {
  milestone_kind: string;
  amount_remaining: string;
  has_pending_claim?: boolean | null;
}

/**
 * A claimable-milestone row is renderable only when it carries the two fields the
 * portal dereferences: a non-empty `milestone_kind` and a string `amount_remaining`.
 * Anything else (a null hole, a stray shape) is dropped — never rendered — so a
 * malformed row can neither crash nor mislead. `has_pending_claim` is read null-safe.
 */
export function isRenderableClaim(row: unknown): row is ClaimableMilestoneRow {
  if (!row || typeof row !== 'object') return false;
  const candidate = row as Record<string, unknown>;
  return (
    typeof candidate.milestone_kind === 'string' &&
    candidate.milestone_kind.length > 0 &&
    typeof candidate.amount_remaining === 'string' &&
    candidate.amount_remaining.length > 0
  );
}

export const STATE_SET = new Set<string>(DESIGN_STATES);

/** The four money statuses the portal knows how to render. */
export const MILESTONE_STATUSES = new Set<string>(['paid', 'partial', 'due']);

/**
 * A schedule row is renderable only when it carries the three fields the portal
 * dereferences: a non-empty `milestone_kind`, a known `status`, and an
 * `amount_due`. Anything else (a null hole, a stray shape, an unknown status) is
 * dropped — never rendered — so a malformed row can neither crash nor mislead.
 */
export function isRenderableMilestone(row: unknown): row is PublicDeliveryMilestone {
  if (!row || typeof row !== 'object') return false;
  const candidate = row as Record<string, unknown>;
  return (
    typeof candidate.milestone_kind === 'string' &&
    candidate.milestone_kind.length > 0 &&
    typeof candidate.status === 'string' &&
    MILESTONE_STATUSES.has(candidate.status) &&
    candidate.amount_due != null
  );
}
