import { NextResponse, type NextRequest } from 'next/server';
import {
  PREVIEW_MAX_EDGE,
  PREVIEW_QUALITY,
} from '@/lib/engagements/document-access';
import { getDeliveryDocumentByToken, type DeliveryDocumentTarget } from '@/lib/engagements/public-documents';
import { LOCALES, routing } from '@/i18n/routing';
import { createSignedObjectUrl } from '@/lib/storage/signed-urls';
import { isUuid } from '@/lib/uuid';

// Client Deliverables, Step 1 — the session-less endpoint for ONE released
// document of a tokenized delivery. GET only; the share token in the path IS the
// authorization (the SDF resolves the delivery solely by its hash).
//
// TWO WAYS TO HAND IT OVER. No `variant` is the download (an attachment named
// for the client, or the preview rendition). `?variant=view` opens it in the
// browser: signed WITHOUT a download name, so no attachment disposition is
// forced. Any other `variant` is refused like a forged id.
//
// NO ORACLE: every failure — a non-uuid document id, a forged id, another delivery's
// artifact, an unreleased artifact, an unknown/revoked/expired token, an unknown
// variant, a Storage error, any throw — produces the IDENTICAL 303 back to the
// portal with `?document=unavailable`. Never a 404 body, never a 500, never a
// distinguishable response, so a caller cannot probe which documents or
// deliveries exist.

/** How long the client's signed link stays valid: long enough to open a large
 *  PDF and reload its tab, short enough not to be worth passing around. */
const SIGNED_URL_TTL_SECONDS = 300;

/** No caching, and the share token must never ride a Referer to Storage. */
const SAFE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const;

/** The storage-side downscale a PREVIEW is served through, whichever variant. */
const PREVIEW_TRANSFORM = {
  width: PREVIEW_MAX_EDGE,
  height: PREVIEW_MAX_EDGE,
  resize: 'contain',
  quality: PREVIEW_QUALITY,
} as const;

type HandOver = 'download' | 'view';

/** The hand-over a `variant` asks for, or null for one this route does not know. */
function handOverOf(variant: string | null): HandOver | null {
  if (variant === null) return 'download';
  return variant === 'view' ? 'view' : null;
}

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

/**
 * The signed URL for a document the client may have. The object key comes from
 * the `files` row the SDF resolved — never from the request. A PREVIEW is
 * always the downscaled rendition, signed without a download name, so the
 * full-resolution deliverable never reaches an unpaid client. A downloadable
 * file is signed with its client-facing name for a download, and without one
 * for a view.
 */
function signDocument(document: DeliveryDocumentTarget, handOver: HandOver): Promise<string> {
  if (document.access === 'preview') {
    return createSignedObjectUrl(document.bucket, document.objectKey, SIGNED_URL_TTL_SECONDS, {
      transform: PREVIEW_TRANSFORM,
    });
  }
  return createSignedObjectUrl(
    document.bucket,
    document.objectKey,
    SIGNED_URL_TTL_SECONDS,
    handOver === 'download' ? { download: document.downloadName } : undefined,
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string; token: string; documentId: string }> },
): Promise<NextResponse> {
  const { locale, token, documentId } = await params;

  try {
    // Shape checks first: a malformed id or variant never reaches the database.
    const handOver = handOverOf(request.nextUrl.searchParams.get('variant'));
    if (!handOver || !isUuid(documentId)) return unavailable(request, locale, token);

    const document = await getDeliveryDocumentByToken(token, documentId);
    if (!document) return unavailable(request, locale, token);

    // Step 3 — a WITHHELD document (the BOQ before the money is in) is refused with
    // the SAME response as a forged id. The route is the enforcement point, not the
    // portal's button: hiding the button alone would leave the URL guessable by
    // anyone who had it before the payment lapsed.
    if (document.access === 'withheld') return unavailable(request, locale, token);

    const signedUrl = await signDocument(document, handOver);
    return NextResponse.redirect(signedUrl, { status: 302, headers: SAFE_HEADERS });
  } catch {
    // Token-free breadcrumb only — never the raw token or the document id.
    console.error('delivery document download failed');
    return unavailable(request, locale, token);
  }
}
