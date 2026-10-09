import { NextResponse, type NextRequest } from 'next/server';
import { tokenPathSegment } from '@/lib/engagements/portal-path';
import { getDeliveryDocumentByToken } from '@/lib/engagements/public-documents';
import { LOCALES, routing } from '@/i18n/routing';
import { isUuid } from '@/lib/uuid';
import { DOCUMENT_HEADERS, documentResponse, type HandOver } from './document-response';

// Client Deliverables — the session-less endpoint for ONE released document of a
// tokenized delivery. GET only; the share token in the path IS the authorization
// (the SDF resolves the delivery solely by its hash).
//
// TWO WAYS TO HAND IT OVER. No `variant` is the download; `?variant=view` asks
// to open it in the browser, which is honoured only for a file that is safe to
// open (./document-response.ts). Any other `variant` is refused like a forged id.
// While money is outstanding (`preview`), the client gets a downscaled image
// streamed from here and never a storage URL.
//
// NO ORACLE: every failure — a non-uuid document id, a forged id, another delivery's
// artifact, an unreleased artifact, an unknown/revoked/expired token, an unknown
// variant, a withheld document, a Storage error, any throw — produces the
// IDENTICAL 303 back to the portal with `?document=unavailable`. Never a 404 body,
// never a 500, never a distinguishable response, so a caller cannot probe which
// documents or deliveries exist.

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
    `/${safeLocale}/d/${tokenPathSegment(token)}?document=unavailable`,
    request.url,
  );
  return NextResponse.redirect(target, { status: 303, headers: DOCUMENT_HEADERS });
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

    return (await documentResponse(document, handOver)) ?? unavailable(request, locale, token);
  } catch {
    // Token-free breadcrumb only — never the raw token or the document id.
    console.error('delivery document download failed');
    return unavailable(request, locale, token);
  }
}
