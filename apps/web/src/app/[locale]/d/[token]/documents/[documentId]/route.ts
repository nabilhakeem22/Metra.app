import { NextResponse, type NextRequest } from 'next/server';
import { getDeliveryDocumentByToken } from '@/lib/engagements/public-documents';
import { LOCALES, routing } from '@/i18n/routing';
import { createSignedObjectUrl } from '@/lib/storage';

// Client Deliverables, Step 1 — the session-less download endpoint for ONE released
// document of a tokenized delivery. GET only; the share token in the path IS the
// authorization (the SDF resolves the delivery solely by its hash).
//
// NO ORACLE: every failure — a non-uuid document id, a forged id, another delivery's
// artifact, an unreleased artifact, an unknown/revoked/expired token, a Storage
// error, any throw — produces the IDENTICAL 303 back to the portal with
// `?document=unavailable`. Never a 404 body, never a 500, never a distinguishable
// response, so a caller cannot probe which documents or deliveries exist.

/** Canonical uuid shape — checked BEFORE any DB call. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long the client's signed link stays valid — long enough for the browser to
 *  follow the redirect and start the download, short enough not to be shareable. */
const SIGNED_URL_TTL_SECONDS = 60;

/** No caching, and the share token must never ride a Referer to Storage. */
const SAFE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const;

function isLocale(value: string): boolean {
  return (LOCALES as readonly string[]).includes(value);
}

/** The single, indistinguishable failure response. */
function unavailable(
  request: NextRequest,
  locale: string,
  token: string,
): NextResponse {
  const safeLocale = isLocale(locale) ? locale : routing.defaultLocale;
  const target = new URL(
    `/${safeLocale}/d/${encodeURIComponent(token)}?document=unavailable`,
    request.url,
  );
  return NextResponse.redirect(target, { status: 303, headers: SAFE_HEADERS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string; token: string; documentId: string }> },
): Promise<NextResponse> {
  const { locale, token, documentId } = await params;

  try {
    // Shape check first: a malformed id never reaches the database.
    if (!UUID_RE.test(documentId ?? '')) return unavailable(request, locale, token);

    const document = await getDeliveryDocumentByToken(token, documentId);
    if (!document) return unavailable(request, locale, token);

    // The object key comes from the `files` row the SDF resolved — never from the
    // request. The saved filename is the client-facing category slug.
    const signedUrl = await createSignedObjectUrl(
      document.bucket,
      document.objectKey,
      SIGNED_URL_TTL_SECONDS,
      { download: document.downloadName },
    );
    return NextResponse.redirect(signedUrl, { status: 302, headers: SAFE_HEADERS });
  } catch {
    // Token-free breadcrumb only — never the raw token or the document id.
    console.error('delivery document download failed');
    return unavailable(request, locale, token);
  }
}
