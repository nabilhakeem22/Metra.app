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
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { safeExtension } from '@/lib/files/safe-name';
import { parseDocumentAccess, type DocumentAccess } from './document-access';
import { isUuid } from '@/lib/uuid';
import {
  CATEGORY_FILE_SLUG,
  KIND_CATEGORY,
  isClientDocumentKind,
} from './portal-documents';

export interface DeliveryDocumentTarget {
  bucket: string;
  objectKey: string;
  /** The name the client's browser saves the file as — a category slug plus, when
   *  one can be derived safely, the original extension. Never the stored filename. */
  downloadName: string;
  /** Step 3 — the DATABASE's verdict on what this client may do with the file now.
   *  The route enforces it; it is not advisory. Junk parses to `withheld`. */
  access: DocumentAccess;
}

/** The raw jsonb the SDF returns. Typed as UNTRUSTED — every field is optional. */
interface DocumentSnapshot {
  bucket?: string | null;
  object_key?: string | null;
  kind?: string | null;
  original_name?: string | null;
  access?: string | null;
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
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  if (!isUuid(documentId)) return null;
  const hash = hashShareToken(token);

  try {
    const snapshot = await readSdfJson<DocumentSnapshot>(
      sql`select public.app_delivery_document_by_token(${hash}, ${documentId}::uuid) as data`,
    );
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
      access: parseDocumentAccess(snapshot.access),
    };
  } catch {
    // Token-free breadcrumb only — never the raw token, the document id, or any
    // client data. A throw is indistinguishable from a miss to the caller.
    console.error('delivery document read failed');
    return null;
  }
}
