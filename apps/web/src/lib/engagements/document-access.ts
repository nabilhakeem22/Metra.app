// Client Deliverables, Step 3 — what a client may DO with a released document,
// depending on whether the engagement's payments are settled. PURE and
// CLIENT-SAFE: no db import, no `server-only`, no 'use client'.
//
// THE RULE ITSELF LIVES IN SQL (`public.app_document_access`), deliberately, and is
// NOT re-implemented here. Both the portal list and the download route read the
// verdict the database computed, so the button the client sees and the bytes the
// route will serve can never disagree — the classic drift bug for a "you may look
// but not take" feature. This module owns only the TYPE and the parsing of an
// UNTRUSTED verdict string coming back as jsonb.

/**
 * The three verdicts, in increasing order of what the client gets:
 *  - `withheld` — not retrievable at all. The BOQ before the money is in: it
 *    carries the firm's own rates and is the thing the studio is paid for.
 *  - `preview`  — viewable but not deliverable. The approved 3D render before the
 *    money is in: a downscaled rendition renders in the portal, the
 *    full-resolution file does not leave the bucket.
 *  - `download` — the full file. Everything else, and everything once settled.
 */
export type DocumentAccess = 'withheld' | 'preview' | 'download';

const ACCESS_VALUES: ReadonlySet<string> = new Set<DocumentAccess>([
  'withheld',
  'preview',
  'download',
]);

/**
 * Read an access verdict off untrusted jsonb. Anything unrecognised — a missing
 * key, a null hole, a verdict added in SQL but not yet known here — falls back to
 * the SAFEST value, `withheld`, never to `download`. A parser that guessed
 * "download" on junk would hand over the priced BOQ on a malformed row.
 */
export function parseDocumentAccess(value: unknown): DocumentAccess {
  return typeof value === 'string' && ACCESS_VALUES.has(value)
    ? (value as DocumentAccess)
    : 'withheld';
}

/** The longest edge, in pixels, of a `preview` rendition. Large enough to judge a
 *  design on screen, far short of a print-quality deliverable. */
export const PREVIEW_MAX_EDGE = 1400;

/** JPEG quality of a `preview` rendition — visibly good, not a master file. */
export const PREVIEW_QUALITY = 62;
