import 'server-only';
// Client Deliverables, Step 1 — the session-less document resolver behind the
// portal's download route. Runs the SECURITY DEFINER token SDF on the base
// connection — NO withOrgContext, NO org GUCs, NO can(). The token IS the auth
// (mirrors ./public.ts). The raw token is never logged.
//
// The caller-supplied `documentId` is only a FILTER inside a delivery the token
// already proved; the storage location always comes back from the `files` row the
// SDF joined, never from anything the caller sent. Every failure — forged uuid,
// another delivery's artifact, an unreleased or fileless artifact, an unknown /
// revoked / expired token, a DB throw — resolves to the SAME null, so the endpoint
// has no oracle to probe.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
import { ALLOWED_EXTENSIONS } from './deliverable-files';
import {
  CATEGORY_FILE_SLUG,
  KIND_CATEGORY,
  isClientDocumentKind,
} from './portal-documents';

/** Canonical uuid shape — validated BEFORE the id ever reaches the DB. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ONLY extensions that may appear in a client download name — the union of the
 * upload allowlist, so the two can never drift (pdf, dwg, dxf, png, jpg, jpeg,
 * xlsx, csv). Deliberately an ALLOWLIST, not a shape check: `download=` is appended
 * to the signed URL AFTER signing and is therefore not covered by the storage JWT,
 * so an attacker who obtains a link can strip it. Anything active (html, htm, svg,
 * xml, …) must never be able to ride the name; an unknown extension is dropped and
 * the file is simply saved as the bare category slug.
 *
 * `public-documents.test.ts` pins the resulting union, so widening the UPLOAD
 * allowlist to an active type fails loudly there instead of silently reaching the
 * client.
 */
const DOWNLOAD_NAME_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.values(ALLOWED_EXTENSIONS).flat(),
);

export interface DeliveryDocumentTarget {
  bucket: string;
  objectKey: string;
  /** The name the client's browser saves the file as — a category slug plus, when
   *  one can be derived safely, the original extension. Never the stored filename. */
  downloadName: string;
}

/** The raw jsonb the SDF returns. Typed as UNTRUSTED — every field is optional. */
interface DocumentSnapshot {
  bucket?: string | null;
  object_key?: string | null;
  kind?: string | null;
  original_name?: string | null;
}

/**
 * The lowercase extension of a stored filename, or null. TWO gates, in order:
 *  1. SHAPE — the final dot-segment must be 1–5 ASCII alphanumerics after
 *     lowercasing, so nothing with a quote, semicolon, newline, slash or unicode
 *     can ever reach a Content-Disposition header;
 *  2. MEMBERSHIP — it must be one of DOWNLOAD_NAME_EXTENSIONS. Shape alone was not
 *     enough: `html`/`htm`/`svg` all pass it, and the `download=` param that would
 *     force an attachment is appended after the URL is signed and can be stripped.
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
 * Resolve ONE released document of a delivery by its RAW share token, or null. The
 * token is sha256-hashed here (never sent to the DB in the clear, never logged).
 * Returns the bucket + object key to sign, and the client-facing download name.
 */
export async function getDeliveryDocumentByToken(
  rawToken: string,
  documentId: string,
): Promise<DeliveryDocumentTarget | null> {
  if (!rawToken || !rawToken.trim()) return null;
  if (typeof documentId !== 'string' || !UUID_RE.test(documentId)) return null;
  const hash = createHash('sha256').update(rawToken.trim()).digest('hex');

  try {
    const rows = (await withRequestDb((db) =>
      db.execute(
        sql`select public.app_delivery_document_by_token(${hash}, ${documentId}::uuid) as data`,
      ),
    )) as unknown as Array<{ data: DocumentSnapshot | null }>;
    const snapshot = rows[0]?.data ?? null;
    if (!snapshot) return null;

    const { bucket, object_key: objectKey } = snapshot;
    if (typeof bucket !== 'string' || bucket.length === 0) return null;
    if (typeof objectKey !== 'string' || objectKey.length === 0) return null;
    if (!isClientDocumentKind(snapshot.kind)) return null;

    const slug = CATEGORY_FILE_SLUG[KIND_CATEGORY[snapshot.kind]];
    const extension = safeExtension(snapshot.original_name);
    return {
      bucket,
      objectKey,
      downloadName: extension ? `${slug}.${extension}` : slug,
    };
  } catch {
    // Token-free breadcrumb only — never the raw token, the document id, or any
    // client data. A throw is indistinguishable from a miss to the caller.
    console.error('delivery document read failed');
    return null;
  }
}
