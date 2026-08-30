// Client Deliverables, Step 1 — the client-facing document vocabulary. PURE and
// CLIENT-SAFE (no `server-only`, no DB, no I/O): the portal's client component and
// the download route both import it, and the unit tests call it directly.
//
// The client NEVER sees the raw artifact kind, the studio's internal label, or the
// stored filename — only a friendly category, which is what these maps produce.
import type { EngagementArtifactKind } from '@metra/db';

/** The document families the client portal knows how to name. */
export type ClientDocumentCategory =
  | 'concept'
  | 'layout'
  | 'render'
  | 'drawing'
  | 'boq'
  | 'survey';

/**
 * Artifact kind -> client-facing category. TOTAL over the artifact-kind enum, so a
 * newly added kind is a compile error here rather than an unlabelled row in the
 * portal. A kind that is NOT in this map is dropped by the read mapper (see
 * public.ts) — the portal never renders a category it cannot name.
 */
export const KIND_CATEGORY: Record<EngagementArtifactKind, ClientDocumentCategory> = {
  concept_option: 'concept',
  autocad: 'layout',
  approved_render: 'render',
  shop_drawing: 'drawing',
  boq: 'boq',
  survey: 'survey',
};

/**
 * The ASCII slug used to build the DOWNLOADED filename. Deliberately ASCII and
 * category-based: the stored `original_name` may carry the firm's internal naming
 * (and non-ASCII bytes that a Content-Disposition header handles badly), so the
 * client's copy is named after what the file IS, never after what the studio
 * called it.
 */
export const CATEGORY_FILE_SLUG: Record<ClientDocumentCategory, string> = {
  concept: 'concept-option',
  layout: '2d-layout',
  render: '3d-visual',
  drawing: 'shop-drawing',
  boq: 'bill-of-quantities',
  survey: 'site-survey',
};

/** True only for an artifact kind the portal has a client-facing category for. */
export function isClientDocumentKind(
  kind: unknown,
): kind is EngagementArtifactKind {
  return (
    typeof kind === 'string' &&
    Object.prototype.hasOwnProperty.call(KIND_CATEGORY, kind)
  );
}
