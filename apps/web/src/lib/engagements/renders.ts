// Design-Engagement Machine, Step 11 — the `captureRenderManifest` side-effect of
// `rendersReady` (design_3d -> final_approval). Executor-only: MUST be called with
// the executor's `tx` so the baseline manifest is stamped ATOMICALLY with the
// design_3d -> final_approval state move, or rolls back with it. The
// `rendersPresent` guard has already proven at least one approved render exists, so
// the captured baseline is never empty. `node:crypto` is server-only (nodejs_compat
// on Cloudflare Workers) — do NOT import this module into a `'use client'` file.
import {
  designEngagements,
  engagementArtifacts,
  type MetraDb,
} from '@metra/db';
import { and, asc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

/** The render identity a manifest hash is built from (one approved-render row). */
export interface RenderManifestEntry {
  id: string;
  contentHash: string | null;
}

/**
 * The deterministic baseline hash over a set of approved renders. PURE — no DB, no
 * `tx` — so it is unit-testable in plain vitest. Each render contributes its
 * `contentHash`, falling back to its artifact `id` when the content hash is null;
 * the identities are sorted lexicographically (so input order never changes the
 * result), newline-joined, and hashed with sha256. Returns the lowercase hex
 * digest. The `rendersPresent` guard guarantees a non-empty input at the call site.
 */
export function computeRenderManifestHash(
  renders: RenderManifestEntry[],
): string {
  const identities = renders
    .map((render) => render.contentHash ?? render.id)
    .sort();
  return createHash('sha256').update(identities.join('\n')).digest('hex');
}

/**
 * Load the engagement's `approved_render` artifacts, compute the baseline manifest
 * hash over them, and stamp `render_manifest_hash` + `renders_ready_at` on the
 * engagement. Runs inside the executor's tx so the stamp commits atomically with
 * the design_3d -> final_approval move — a guard failure earlier in the tx leaves
 * both columns null. RLS scopes the read + UPDATE to the caller's org via the
 * ambient tx context. Ordered by `id` in the query for stable loading; the hash
 * helper re-sorts regardless, so determinism does not depend on this order.
 */
export async function captureRenderManifest(
  tx: MetraDb,
  engagementId: string,
): Promise<void> {
  const renders = await tx
    .select({
      id: engagementArtifacts.id,
      contentHash: engagementArtifacts.contentHash,
    })
    .from(engagementArtifacts)
    .where(
      and(
        eq(engagementArtifacts.engagementId, engagementId),
        eq(engagementArtifacts.kind, 'approved_render'),
      ),
    )
    .orderBy(asc(engagementArtifacts.id));

  const renderManifestHash = computeRenderManifestHash(renders);
  await tx
    .update(designEngagements)
    .set({ renderManifestHash, rendersReadyAt: new Date(), updatedAt: new Date() })
    .where(eq(designEngagements.id, engagementId));
}
