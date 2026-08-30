// Client Deliverables, Step 1 — the release table. PURE and CLIENT-SAFE: which
// artifact kinds a lifecycle transition releases to the tokenized client portal,
// and the deterministic selector that turns a release + the artifacts the executor
// already loaded into the exact set of artifact ids to make visible.
//
// No I/O, no DB, no `server-only` — the executor calls it inside its transaction
// over the artifacts it loaded as guard facts (zero extra reads), and the unit test
// calls it directly.
//
// TWO INVARIANTS the whole feature rests on:
//  1. Visibility is only ever ADDED. This selector returns ids to SHOW; nothing in
//     the auto-share path can ever hide an artifact the studio chose to share.
//  2. A `boq` is NEVER auto-released — it is deliberately absent from every release
//     below. A bill of quantities can carry the firm's own rates, and no
//     source-level check can inspect the inside of an uploaded workbook, so the BOQ
//     stays manual-only and hidden by default.
import type { EngagementArtifactKind } from '@metra/db';

/** The three release points on the lifecycle. */
export type ClientReleaseKey =
  | 'conceptPackage'
  | 'designPackage'
  | 'handoverPackage';

export interface ClientRelease {
  /** Every file-bearing artifact of these kinds is released. */
  allOf: readonly EngagementArtifactKind[];
  /** Only the NEWEST file-bearing artifact of each of these kinds is released. */
  latestOf: readonly EngagementArtifactKind[];
}

/**
 * What each release point shares.
 *  - `conceptPackage` (optionsReady): all the concept options the client is being
 *    asked to choose between, plus the single current 2D layout.
 *  - `designPackage` (rendersReady): the approved 3D renders.
 *  - `handoverPackage` (chooseDesignOnly): the shop drawings the client is handed.
 * `boq` appears in NONE of them, deliberately — see the header note.
 *
 * TRIPWIRE (`autocad` is a SHARED kind). It backs BOTH the studio's own 2D layout
 * (uploaded through the deliverable tray, which attaches a file) AND a developer /
 * consultant CAD import recorded through the artifact panel. Today the import is
 * excluded only INCIDENTALLY: that UI path attaches no file, so `hasFile` filters it
 * out. If file attachment is ever added to the artifact panel, a developer's CAD set
 * would auto-publish to the client on `optionsReady`. Before that lands this table
 * needs a provenance discriminator (an origin column on the artifact, or a distinct
 * kind) — do NOT keep relying on the fileless accident.
 */
export const CLIENT_RELEASES: Record<ClientReleaseKey, ClientRelease> = {
  conceptPackage: { allOf: ['concept_option'], latestOf: ['autocad'] },
  designPackage: { allOf: ['approved_render'], latestOf: [] },
  handoverPackage: { allOf: ['shop_drawing'], latestOf: [] },
};

/**
 * The minimum an artifact must carry to be considered for release. Structural, so
 * both the DB row (`EngagementArtifact`) and the read-model
 * (`EngagementArtifactRecord`) satisfy it without a cast.
 */
export interface ReleasableArtifact {
  id: string;
  kind: EngagementArtifactKind;
  fileId: string | null;
  attestedAt: Date;
}

/** An artifact can only be released once it actually carries a file to download. */
function hasFile(artifact: ReleasableArtifact): boolean {
  return typeof artifact.fileId === 'string' && artifact.fileId.length > 0;
}

/**
 * Which of `artifacts` this release makes client-visible.
 *
 * `allOf` kinds contribute every file-bearing artifact; `latestOf` kinds contribute
 * only the one with the newest `attestedAt` (ties broken by the lexicographically
 * smallest id, so the answer never depends on row order). Artifacts with no
 * `fileId` are ignored — there would be nothing to download. The result is deduped
 * and sorted, so the same inputs in any order produce the identical list; an empty
 * input (or a release that matches nothing) produces `[]`.
 *
 * The caller only ever turns the returned ids ON — this never asks for a revoke.
 */
export function selectReleaseArtifactIds(
  release: ClientRelease,
  artifacts: readonly ReleasableArtifact[],
): string[] {
  const selected = new Set<string>();

  for (const artifact of artifacts) {
    if (hasFile(artifact) && release.allOf.includes(artifact.kind)) {
      selected.add(artifact.id);
    }
  }

  for (const kind of release.latestOf) {
    const newest = artifacts.reduce<ReleasableArtifact | null>((best, artifact) => {
      if (artifact.kind !== kind || !hasFile(artifact)) return best;
      if (best === null) return artifact;
      const delta =
        new Date(artifact.attestedAt).getTime() - new Date(best.attestedAt).getTime();
      if (delta > 0) return artifact;
      if (delta === 0 && artifact.id < best.id) return artifact;
      return best;
    }, null);
    if (newest) selected.add(newest.id);
  }

  return [...selected].sort();
}
