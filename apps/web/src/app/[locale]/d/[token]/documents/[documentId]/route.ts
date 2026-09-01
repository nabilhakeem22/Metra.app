import { NextResponse, type NextRequest } from 'next/server';
import {
  PREVIEW_MAX_EDGE,
  PREVIEW_QUALITY,
} from '@/lib/engagements/document-access';
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

    // Step 3 — a WITHHELD document (the BOQ before the money is in) is refused with
    // the SAME response as a forged id. The route is the enforcement point, not the
    // portal's button: hiding the button alone would leave the URL guessable by
    // anyone who had it before the payment lapsed.
    if (document.access === 'withheld') return unavailable(request, locale, token);

    // The object key comes from the `files` row the SDF resolved — never from the
    // request. A PREVIEW is signed WITHOUT a download name (so no attachment
    // disposition is forced) and WITH a storage-side transform, so the bytes that
    // leave the bucket are a downscaled rendition — the full-resolution deliverable
    // never reaches an unpaid client. Anything else keeps the Step-1 behaviour.
    const signedUrl =
      document.access === 'preview'
        ? await createSignedObjectUrl(
            document.bucket,
            document.objectKey,
            SIGNED_URL_TTL_SECONDS,
            {
              transform: {
                width: PREVIEW_MAX_EDGE,
                height: PREVIEW_MAX_EDGE,
                resize: 'contain',
                quality: PREVIEW_QUALITY,
              },
            },
          )
        : await createSignedObjectUrl(
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
