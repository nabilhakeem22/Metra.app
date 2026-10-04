import 'server-only';
import { engagementArtifacts, files } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * Is THIS BOQ in the client's delivery link on this engagement? True when a
 * client-visible `boq` artifact on the engagement is this BOQ's issued PDF.
 *
 * Both issue paths store that PDF as `<documentNumber>.pdf`, and the `files` row
 * is never renamed, so the stored file name identifies the BOQ. A BOQ issued
 * before every issue published (its artifact was left hidden), one hidden by
 * hand, or one issued through ANOTHER engagement of the project is not shared
 * here, and the BOQ step must not say "sent". No data is backfilled for it.
 */
export async function isBoqSharedOnEngagement(
  ctx: OrgContext,
  input: { engagementId: string; documentNumber: string },
): Promise<boolean> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: engagementArtifacts.id })
      .from(engagementArtifacts)
      .innerJoin(
        files,
        and(eq(files.id, engagementArtifacts.fileId), eq(files.orgId, engagementArtifacts.orgId)),
      )
      .where(
        and(
          eq(engagementArtifacts.engagementId, input.engagementId),
          eq(engagementArtifacts.kind, 'boq'),
          eq(engagementArtifacts.clientVisible, true),
          eq(files.originalName, `${input.documentNumber}.pdf`),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}
