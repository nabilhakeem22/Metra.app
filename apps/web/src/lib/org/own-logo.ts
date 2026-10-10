import 'server-only';
// The signed-in member's OWN studio logo, for Settings. Read under the org's RLS
// context (withOrgContext), and pinned to ctx.orgId on top of it: the org row
// and the file row must both be the caller's active org. The location never
// leaves the server (the route streams a rendition of it).
import { files, organizations } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { LogoLocation } from '@/lib/storage/logo-rendition-response';
import { hasLogoImageName } from './logo-rules';

/** The caller's org logo, or null when it has none or it is not a png, jpg or webp. */
export async function getOwnOrgLogo(ctx: OrgContext): Promise<LogoLocation | null> {
  const [logo] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ bucket: files.bucket, objectKey: files.objectKey, originalName: files.originalName })
      .from(organizations)
      .innerJoin(files, and(eq(files.id, organizations.logoFileId), eq(files.orgId, organizations.id)))
      .where(eq(organizations.id, ctx.orgId))
      .limit(1),
  );
  if (!logo || !hasLogoImageName(logo.originalName)) return null;
  return { bucket: logo.bucket, objectKey: logo.objectKey };
}
