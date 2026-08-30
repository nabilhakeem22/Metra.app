// Deliverable Uploads — the pure validation + mapping layer for real file uploads
// into the Delivery "Working files" tray. PURE and CLIENT-SAFE: no I/O, no
// 'use client', no server-only import. The tray (a client component) imports
// `ALLOWED_EXTENSIONS` for its file-picker `accept` list AND its friendly
// pre-flight check, while the server actions import the same constants — one
// source of truth, no drift between what the picker offers and what the server
// enforces.
import type { ActionCode } from '@/lib/actions/result';
import type { EngagementArtifactKind } from '@metra/db';
import type { WorkingFileCategory } from './working-files';

/**
 * The artifact kind an upload WRITES for each working-file category. This must be
 * a kind the same category's tray slot READS (`CATEGORY_KINDS` in
 * working-files.ts), or an uploaded deliverable would never surface in its slot:
 *   layout        -> 'autocad'          (layout reads ['concept_option', 'autocad'])
 *   render        -> 'approved_render'  (render reads ['approved_render'])
 *   boq           -> 'boq'              (boq reads ['boq'])
 *   shopDrawing   -> 'shop_drawing'     (upload-only — no pinned tray slot)
 *   conceptOption -> 'concept_option'   (upload-only — no pinned tray slot)
 * Recording the artifact IS attesting it (see artifacts.ts), so an uploaded
 * deliverable also satisfies the category's guard — hence the stage becomes
 * advanceable (owner decision: no auto-advance).
 *
 * `conceptOption` and `layout` are deliberately DISTINCT categories over the same
 * file types: `layout` writes the `autocad` spatial base that `spatialBaseReady`
 * consumes, while `conceptOption` writes the `concept_option` artifacts that
 * `optionsReady` counts (2–4 of them). Collapsing them would make one of the two
 * guards unsatisfiable through the UI.
 */
export const CATEGORY_WRITE_KIND: Record<
  WorkingFileCategory,
  EngagementArtifactKind
> = {
  layout: 'autocad',
  render: 'approved_render',
  boq: 'boq',
  shopDrawing: 'shop_drawing',
  conceptOption: 'concept_option',
};

/**
 * The file extensions each category accepts (lowercased, no dot). Validation is
 * by EXTENSION, not MIME — browsers report inconsistent MIME types for CAD/BOQ
 * formats, and the object key never trusts client MIME.
 */
export const ALLOWED_EXTENSIONS: Record<
  WorkingFileCategory,
  readonly string[]
> = {
  layout: ['pdf', 'dwg', 'dxf', 'png', 'jpg', 'jpeg'],
  render: ['png', 'jpg', 'jpeg', 'pdf'],
  boq: ['xlsx', 'pdf', 'csv'],
  shopDrawing: ['pdf', 'dwg', 'dxf', 'png', 'jpg', 'jpeg'],
  conceptOption: ['pdf', 'dwg', 'dxf', 'png', 'jpg', 'jpeg'],
};

/** Owner decision: the largest deliverable we accept is 100 MB. */
export const MAX_DELIVERABLE_BYTES = 100 * 1024 * 1024;

/**
 * The file-picker `accept` list for a category — its allowed extensions,
 * dot-prefixed and comma-joined (e.g. `.pdf,.dwg`). PURE and client-safe; shared
 * by every upload affordance (the working-files tray + the command-card inline
 * dropzone) so the picker offers exactly what the server enforces.
 */
export function acceptFor(category: WorkingFileCategory): string {
  return ALLOWED_EXTENSIONS[category].map((extension) => `.${extension}`).join(',');
}

/** The lowercased extension (no dot) of a filename, or null if it has none. */
function extensionOf(originalName: string): string | null {
  const dot = originalName.lastIndexOf('.');
  if (dot < 0 || dot === originalName.length - 1) return null;
  return originalName.slice(dot + 1).toLowerCase();
}

/**
 * Validate a candidate deliverable against its category BEFORE any Storage write.
 * Returns an `ActionCode` to reject with, or `null` when the file is acceptable:
 *   'invalid'         — missing or not-allowed extension for this category
 *   'file_too_large'  — known size exceeds MAX_DELIVERABLE_BYTES
 * Extension is checked first, so a wrong-type file is `invalid` regardless of
 * size. `sizeBytes` is optional (the browser always knows it; a raw API caller
 * may not) — when absent, the size gate is skipped and Storage enforces nothing
 * beyond the extension contract.
 */
export function validateDeliverableFile(
  category: WorkingFileCategory,
  originalName: string,
  sizeBytes?: number,
): ActionCode | null {
  const extension = extensionOf(originalName ?? '');
  if (extension === null || !ALLOWED_EXTENSIONS[category].includes(extension)) {
    return 'invalid';
  }
  if (sizeBytes != null && sizeBytes > MAX_DELIVERABLE_BYTES) {
    return 'file_too_large';
  }
  return null;
}
