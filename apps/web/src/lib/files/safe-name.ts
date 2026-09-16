// The name a browser is told to save a downloaded file as. PURE and client-safe:
// no `server-only`, no db, no Supabase.
//
// It lives here rather than in a portal because BOTH download surfaces need it.
// The client portal has had it since Step 1; the internal documents tab signed
// its URLs with no download name at all, so an uploaded `Invoice.html` — the
// content type is taken verbatim from the browser at upload — was served INLINE
// from the Supabase project origin and executed there. Cross-origin from the
// Metra app, so no session theft; the realistic harm is in-org phishing under a
// URL that looks like the firm's own storage.
import { ALLOWED_EXTENSIONS } from '@/lib/engagements/deliverable-files';

/**
 * The ONLY extensions that may appear in a download name — the union of the
 * upload allowlist, so the two can never drift (pdf, dwg, dxf, png, jpg, jpeg,
 * xlsx, csv). Deliberately an ALLOWLIST, not a shape check: `download=` is
 * appended to the signed URL AFTER signing and is therefore not covered by the
 * storage JWT, so whoever holds the link can strip it. Anything active (html,
 * htm, svg, xml, …) must never be able to ride the name.
 *
 * `safe-name.test.ts` pins the resulting union, so widening the UPLOAD allowlist
 * to an active type fails loudly there instead of silently reaching a browser.
 */
const DOWNLOAD_NAME_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.values(ALLOWED_EXTENSIONS).flat(),
);

/** What a file with no usable name of its own is saved as. */
export const DEFAULT_DOWNLOAD_STEM = 'document';

/**
 * The lowercase extension of a stored filename, or null. TWO gates, in order:
 *  1. SHAPE — the final dot-segment must be 1–5 ASCII alphanumerics after
 *     lowercasing, so nothing with a quote, semicolon, newline, slash or unicode
 *     can ever reach a Content-Disposition header;
 *  2. MEMBERSHIP — it must be one of DOWNLOAD_NAME_EXTENSIONS. Shape alone was
 *     not enough: `html`/`htm`/`svg` all pass it.
 * Anything else yields null and the download name carries no extension at all.
 */
export function safeExtension(originalName: string | null | undefined): string | null {
  if (typeof originalName !== 'string') return null;
  const dot = originalName.lastIndexOf('.');
  if (dot < 0 || dot === originalName.length - 1) return null;
  const candidate = originalName.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,5}$/.test(candidate)) return null;
  return DOWNLOAD_NAME_EXTENSIONS.has(candidate) ? candidate : null;
}

/**
 * The part before the extension, reduced to characters that are safe in a
 * header and meaningless to a shell: ASCII letters, digits, space, underscore,
 * hyphen. Null when nothing survives.
 *
 * Non-ASCII goes, Arabic included — the tab still shows the studio the TRUE
 * `original_name`, and a header filename is not the place to litigate RFC 5987.
 */
function safeStem(originalName: string): string | null {
  const dot = originalName.lastIndexOf('.');
  // `dot === 0` is a dotfile (".pdf"): there is no stem, not a stem of ".pdf".
  const stem = dot >= 0 ? originalName.slice(0, dot) : originalName;
  const cleaned = stem
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  return cleaned === '' ? null : cleaned;
}

/**
 * A stored filename as something safe to hand a browser.
 *
 * Always returns a name, because passing one at all is the point: Supabase
 * serves a signed URL with a `download` option as `Content-Disposition:
 * attachment`, so the file is SAVED rather than rendered on the storage origin.
 * A refused extension (`.html`, `.svg`, `.exe`) is simply dropped — the studio
 * gets `Invoice` instead of `Invoice.html`, saved, not executed.
 */
export function safeDownloadName(originalName: string | null | undefined): string {
  const stem =
    (typeof originalName === 'string' ? safeStem(originalName) : null) ??
    DEFAULT_DOWNLOAD_STEM;
  const extension = safeExtension(originalName);
  return extension ? `${stem}.${extension}` : stem;
}
