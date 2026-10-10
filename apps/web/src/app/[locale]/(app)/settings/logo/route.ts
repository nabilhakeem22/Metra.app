import type { NextResponse } from 'next/server';
import { requireOrg } from '@/lib/auth/require-org';
import { getOwnOrgLogo } from '@/lib/org/own-logo';
import { logoRenditionResponse } from '@/lib/storage/logo-rendition-response';

// The studio's OWN logo, for its Settings page. GET only, behind requireOrg:
// the logo is the signed-in member's active org's, read under its RLS context,
// and nothing in the request can name another org.
//
// Same answer as the client page's logo (lib/storage/logo-rendition-response.ts):
// streamed rendition bytes, never a storage URL; no logo, a logo that is not a
// png, jpg or webp, and any failure are the same empty 404. The `?v=` the page
// adds is only a cache key (the logo's file id), never read here.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  // Outside the helper's catch: an unauthenticated request must still redirect.
  const ctx = await requireOrg();
  return logoRenditionResponse(() => getOwnOrgLogo(ctx), 'org logo failed');
}
