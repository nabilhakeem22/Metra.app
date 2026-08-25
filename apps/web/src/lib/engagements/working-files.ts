// Epic D, Slice 5 — the "Working files" read-model. A PURE derivation over the
// artifacts a page has ALREADY loaded (no DB round-trip): it collapses the flat
// artifact list into the three pinned working-file categories the cockpit tray
// shows — the 2D layout, the render set, and the draft BOQ.
//
// There is NO stored "approved" flag on an artifact: in this domain, RECORDING an
// artifact IS attesting it (see lib/engagements/artifacts.ts), so a present
// attested artifact of a category's kind is treated as its latest approved
// deliverable. `fileId` is a metadata-only field with no upload/signed-URL wiring
// yet — the tray never fabricates a download; the caller renders an honest
// "not yet available" state when the category has no artifact OR the artifact has
// no attached file.
import type { EngagementArtifactKind } from '@metra/db';
import type { EngagementArtifactRecord } from './queries';

export type WorkingFileCategory = 'layout' | 'render' | 'boq';

/**
 * Which artifact kinds back each working-file category. Order within a list is a
 * preference order, but selection is by recency (attestedAt) — see below.
 * `layout` accepts either a proposed concept option or a developer/consultant CAD
 * set; `render` the signed-off 3D render; `boq` the bill of quantities.
 */
const CATEGORY_KINDS: Record<WorkingFileCategory, readonly EngagementArtifactKind[]> = {
  layout: ['concept_option', 'autocad'],
  render: ['approved_render'],
  boq: ['boq'],
};

/** The three categories, in the pinned tray display order (matches the mock). */
export const WORKING_FILE_CATEGORIES: readonly WorkingFileCategory[] = [
  'layout',
  'render',
  'boq',
];

export interface WorkingFileRow {
  category: WorkingFileCategory;
  /** The latest attested artifact of this category, or null if none exists. */
  latest: EngagementArtifactRecord | null;
  /** How many artifacts of this category exist (the version number of `latest`). */
  version: number;
  /** True only when the latest artifact carries an attached file id. */
  hasFile: boolean;
}

/**
 * Collapse the artifact list into one row per working-file category. The input is
 * assumed newest-first (as `getEngagementArtifacts` returns it, ordered by
 * attestedAt desc) but this does NOT rely on that: it independently picks the
 * artifact with the newest `attestedAt` per category so the result is stable
 * regardless of input order. Pure — no I/O, no mutation of the input.
 */
export function deriveWorkingFiles(
  artifacts: readonly EngagementArtifactRecord[],
): WorkingFileRow[] {
  return WORKING_FILE_CATEGORIES.map((category) => {
    const kinds = CATEGORY_KINDS[category];
    const matches = artifacts.filter((artifact) => kinds.includes(artifact.kind));
    const latest = matches.reduce<EngagementArtifactRecord | null>(
      (newest, artifact) =>
        newest === null ||
        new Date(artifact.attestedAt).getTime() >
          new Date(newest.attestedAt).getTime()
          ? artifact
          : newest,
      null,
    );
    return {
      category,
      latest,
      version: matches.length,
      hasFile: latest?.fileId != null,
    };
  });
}
